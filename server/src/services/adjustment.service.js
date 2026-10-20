const { StockAdjustment, ProductVariant } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, dateRange, escapeRegex, round2 } = require('../utils/common');
const { runInTransaction } = require('../utils/transaction');
const settingsService = require('./settings.service');
const stockService = require('./stock.service');
const audit = require('./audit.service');

// damage / missing reduce stock, found adds, correction & opening may be +/-.
const SIGN = { damage: -1, missing: -1, found: 1 };

async function create(req, data) {
  const branchId = data.branchId || req.branchId;
  if (!branchId) throw ApiError.badRequest('Select a branch');
  if (req.allowedBranchIds && !req.allowedBranchIds.includes(String(branchId))) throw ApiError.forbidden();
  const result = await runInTransaction(async (session) => {
    const ids = data.items.map((i) => i.variantId);
    const variants = await ProductVariant.find({ _id: { $in: ids }, companyId: req.companyId }).session(session).lean();
    const vm = new Map(variants.map((v) => [String(v._id), v]));
    const stockMap = await stockService.getStockMap(branchId, ids, session);
    const adjustmentNo = await settingsService.nextNumber(req.companyId, 'adjustment', { branchId, session });
    const lines = [];
    const settings = await settingsService.get(req.companyId);
    for (const it of data.items) {
      const v = vm.get(String(it.variantId));
      if (!v) throw ApiError.badRequest('Product not found');
      const before = stockMap.get(String(v._id))?.current || 0;
      let qty;
      if (data.mode === 'set') {
        // physical count: set stock to the counted quantity
        if (!Number.isInteger(it.qty) || it.qty < 0) throw ApiError.badRequest(`Invalid counted qty for ${v.sku}`);
        qty = it.qty - before;
      } else {
        qty = Number(it.qty);
        if (!Number.isInteger(qty) || qty === 0) throw ApiError.badRequest(`Invalid quantity for ${v.sku}`);
        if (SIGN[data.type]) qty = SIGN[data.type] * Math.abs(qty);
      }
      if (qty === 0) continue;
      const cost = stockMap.get(String(v._id))?.avgCost || v.purchasePrice || 0;
      lines.push({ v, qty, before, cost });
    }
    if (!lines.length) throw ApiError.badRequest('No stock change to record');
    const [adj] = await StockAdjustment.create([{
      companyId: req.companyId, branchId, adjustmentNo, type: data.type, reason: data.reason, userId: req.user._id, userName: req.user.name,
      items: lines.map((l) => ({
        variantId: l.v._id, productId: l.v.productId, productName: l.v.productName, sku: l.v.sku, barcode: l.v.barcode, size: l.v.size, color: l.v.color,
        qty: l.qty, beforeQty: l.before, afterQty: l.before + l.qty, costPrice: l.cost,
      })),
      totalQty: lines.reduce((a, l) => a + l.qty, 0),
      totalValue: round2(lines.reduce((a, l) => a + l.qty * l.cost, 0)),
    }], { session });
    for (const l of lines) {
      await stockService.applyMovement({
        session, companyId: req.companyId, branchId, variant: l.v, qty: l.qty, type: data.type === 'opening' ? 'opening' : 'adjustment',
        refType: 'StockAdjustment', refId: adj._id, refNo: adjustmentNo, userId: req.user._id, note: `${data.type}: ${data.reason}`,
        costPrice: l.qty > 0 ? l.cost : undefined, allowNegative: settings.stock.allowNegativeStock,
      });
    }
    return adj;
  });
  await audit.log(req, { action: 'stock.adjustment', entity: 'StockAdjustment', entityId: result._id, refNo: result.adjustmentNo, branchId, oldValue: result.items.map((i) => ({ sku: i.sku, qty: i.beforeQty })), newValue: result.items.map((i) => ({ sku: i.sku, qty: i.afterQty, change: i.qty })) });
  return result;
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to) };
  if (q.type) filter.type = q.type;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ adjustmentNo: rx }, { reason: rx }, { 'items.sku': rx }];
  }
  return paginate(StockAdjustment, filter, q, { populate: { path: 'branchId', select: 'name' } });
}

module.exports = { create, list };
