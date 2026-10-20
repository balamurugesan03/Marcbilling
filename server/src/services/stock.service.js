const mongoose = require('mongoose');
const { Stock, StockLedger, ProductVariant, Branch } = require('../models');
const ApiError = require('../utils/ApiError');
const { round2, paginate, escapeRegex, dateRange } = require('../utils/common');
const settingsService = require('./settings.service');

// Which Stock counter each movement type feeds. `sign` converts the signed qty into the counter increment.
const FIELD = {
  opening: ['opening', 1],
  purchase: ['purchased', 1],
  purchase_return: ['purchaseReturned', -1],
  sale: ['sold', -1],
  sale_cancel: ['sold', -1],
  sale_return: ['salesReturned', 1],
  transfer_in: ['transferIn', 1],
  transfer_out: ['transferOut', -1],
  adjustment: ['adjustment', 1],
};

/**
 * THE single place where stock changes. Atomically updates Stock and writes a StockLedger row.
 * qty is signed (+ in / - out). Rejects negative stock unless allowed by settings.
 */
async function applyMovement({ session, companyId, branchId, variant, qty, type, refType, refId, refNo, userId, note, costPrice, allowNegative }) {
  if (!qty || !Number.isFinite(qty)) throw ApiError.badRequest('Quantity must be a non-zero number');
  const [field, sign] = FIELD[type] || [];
  if (!field) throw new Error(`Unknown stock movement type ${type}`);
  if (allowNegative === undefined) {
    allowNegative = (await settingsService.get(companyId)).stock.allowNegativeStock;
  }
  const inc = { current: qty, [field]: sign * qty };
  const now = new Date();
  const set = { lastMovementAt: now };
  if (type === 'sale') set.lastSoldAt = now;

  let stock;
  if (qty < 0 && !allowNegative) {
    stock = await Stock.findOneAndUpdate(
      { branchId, variantId: variant._id, current: { $gte: -qty } },
      { $inc: inc, $set: set },
      { new: true, session },
    );
    if (!stock) {
      const existing = await Stock.findOne({ branchId, variantId: variant._id }).session(session).lean();
      const label = [variant.productName, variant.size, variant.color].filter(Boolean).join(' / ');
      throw ApiError.badRequest(`Insufficient stock for ${label} (${variant.sku}): available ${existing?.current || 0}, required ${-qty}`);
    }
  } else {
    stock = await Stock.findOneAndUpdate(
      { branchId, variantId: variant._id },
      { $inc: inc, $set: set, $setOnInsert: { companyId, productId: variant.productId } },
      { new: true, upsert: true, session },
    );
  }

  // weighted average cost on inward movements with a known cost
  if (qty > 0 && costPrice != null && ['purchase', 'opening', 'transfer_in', 'adjustment'].includes(type)) {
    const prevQty = Math.max(0, stock.current - qty);
    const prevAvg = stock.avgCost || 0;
    const avg = prevQty + qty > 0 ? round2((prevQty * prevAvg + qty * costPrice) / (prevQty + qty)) : costPrice;
    if (avg !== stock.avgCost) {
      await Stock.updateOne({ _id: stock._id }, { $set: { avgCost: avg } }, { session });
      stock.avgCost = avg;
    }
  }

  await StockLedger.create([{
    companyId, branchId, variantId: variant._id, productId: variant.productId,
    type, qty, balanceAfter: stock.current, costPrice: costPrice ?? stock.avgCost,
    refType, refId, refNo, note, userId,
  }], { session });

  return stock;
}

async function getStockMap(branchId, variantIds, session = null) {
  const rows = await Stock.find({ branchId, variantId: { $in: variantIds } }).session(session).lean();
  return new Map(rows.map((r) => [String(r.variantId), r]));
}

/** Current stock list (branch-wise; with "all" branches it aggregates per variant). */
async function list(req) {
  const q = req.query;
  const match = { companyId: req.companyId, ...req.branchScope };
  if (q.branchId && !req.branchScope.branchId) match.branchId = new mongoose.Types.ObjectId(q.branchId);
  const settings = await settingsService.get(req.companyId);
  const low = Number(q.lowThreshold ?? settings.stock.lowStockThreshold);
  if (q.status === 'out') match.current = { $lte: 0 };
  else if (q.status === 'low') match.current = { $gt: 0, $lte: low };
  else if (q.status === 'in') match.current = { $gt: 0 };

  const variantMatch = {};
  if (q.search) {
    const s = String(q.search).trim();
    variantMatch.$or = [{ 'v.barcode': s }, { 'v.sku': s.toUpperCase() }, { 'v.searchText': { $regex: escapeRegex(s.toLowerCase()) } }];
  }
  if (q.categoryId) variantMatch['v.categoryId'] = new mongoose.Types.ObjectId(q.categoryId);
  if (q.brandId) variantMatch['v.brandId'] = new mongoose.Types.ObjectId(q.brandId);

  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(500, Number(q.limit) || 25);
  const byBranch = Boolean(match.branchId);

  const pipeline = [{ $match: match }];
  if (!byBranch) {
    pipeline.push({
      $group: {
        _id: '$variantId',
        variantId: { $first: '$variantId' },
        opening: { $sum: '$opening' }, purchased: { $sum: '$purchased' }, purchaseReturned: { $sum: '$purchaseReturned' },
        sold: { $sum: '$sold' }, salesReturned: { $sum: '$salesReturned' }, transferIn: { $sum: '$transferIn' },
        transferOut: { $sum: '$transferOut' }, adjustment: { $sum: '$adjustment' }, current: { $sum: '$current' },
        value: { $sum: { $multiply: ['$current', '$avgCost'] } }, branches: { $sum: 1 },
      },
    });
  }
  pipeline.push(
    { $lookup: { from: 'productvariants', localField: 'variantId', foreignField: '_id', as: 'v' } },
    { $unwind: '$v' },
    { $match: { 'v.deletedAt': null, ...variantMatch } },
    { $sort: { 'v.productName': 1, 'v.color': 1, 'v._id': 1 } },
    {
      $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        meta: [{ $group: { _id: null, total: { $sum: 1 }, qty: { $sum: '$current' }, value: { $sum: byBranch ? { $multiply: ['$current', '$avgCost'] } : '$value' } } }],
      },
    },
  );
  const [res] = await Stock.aggregate(pipeline);
  const meta = res.meta[0] || { total: 0, qty: 0, value: 0 };
  const items = res.items.map((r) => ({
    variantId: r.v._id, productId: r.v.productId, branchId: r.branchId,
    productName: r.v.productName, productCode: r.v.productCode, sku: r.v.sku, barcode: r.v.barcode,
    size: r.v.size, color: r.v.color, category: r.v.categoryName, brand: r.v.brandName,
    mrp: r.v.mrp, sellingPrice: r.v.sellingPrice, purchasePrice: r.v.purchasePrice,
    opening: r.opening, purchased: r.purchased, purchaseReturned: r.purchaseReturned, sold: r.sold,
    salesReturned: r.salesReturned, transferIn: r.transferIn, transferOut: r.transferOut, adjustment: r.adjustment,
    current: r.current, avgCost: r.avgCost, value: round2(byBranch ? r.current * (r.avgCost || r.v.purchasePrice) : r.value),
    status: r.current <= 0 ? 'out' : r.current <= low ? 'low' : 'in',
  }));
  return { items, total: meta.total, page, limit, pages: Math.ceil(meta.total / limit), summary: { qty: meta.qty, value: round2(meta.value) } };
}

/** Stock of one variant in every branch. */
async function variantStock(req, variantId) {
  const rows = await Stock.find({ companyId: req.companyId, variantId }).lean();
  const branches = await Branch.find({ companyId: req.companyId, active: true }).select('name code').lean();
  return branches.map((b) => {
    const r = rows.find((x) => String(x.branchId) === String(b._id));
    return { branchId: b._id, branchName: b.name, current: r?.current || 0, avgCost: r?.avgCost || 0 };
  });
}

async function ledger(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to) };
  if (q.variantId) filter.variantId = q.variantId;
  if (q.type) filter.type = q.type;
  if (q.search && !q.variantId) {
    const s = String(q.search).trim();
    const vs = await ProductVariant.find({
      companyId: req.companyId,
      $or: [{ barcode: s }, { sku: s.toUpperCase() }, { searchText: { $regex: escapeRegex(s.toLowerCase()) } }],
    }).select('_id').limit(200).lean();
    filter.variantId = { $in: vs.map((v) => v._id) };
  }
  const result = await paginate(StockLedger, filter, q, {
    populate: [
      { path: 'variantId', select: 'productName sku barcode size color' },
      { path: 'branchId', select: 'name code' },
      { path: 'userId', select: 'name' },
    ],
  });
  return result;
}

module.exports = { applyMovement, getStockMap, list, variantStock, ledger };
