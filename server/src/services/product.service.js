const mongoose = require('mongoose');
const { Product, ProductVariant, Category, Brand, Stock, SaleItem, Barcode } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, escapeRegex, pick } = require('../utils/common');
const { runInTransaction } = require('../utils/transaction');
const { detectFormat } = require('../utils/barcode');
const barcodeService = require('./barcode.service');
const stockService = require('./stock.service');
const audit = require('./audit.service');

const PRODUCT_FIELDS = ['name', 'categoryId', 'subCategoryId', 'brandId', 'gender', 'season', 'hsnCode', 'gstRate', 'unit',
  'purchasePrice', 'sellingPrice', 'mrp', 'discountPercent', 'supplierId', 'description', 'images', 'fabric', 'pattern', 'style', 'status'];
const VARIANT_ATTRS = ['size', 'color', 'fabric', 'pattern', 'style'];
const PRICE_FIELDS = ['purchasePrice', 'sellingPrice', 'mrp'];

const slug = (s, n = 4) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n);
const comboKey = (v) => VARIANT_ATTRS.map((k) => String(v[k] || '').trim().toLowerCase()).join('|');

async function resolveRefs(companyId, data, session) {
  const [cat, sub, brand] = await Promise.all([
    Category.findOne({ _id: data.categoryId, companyId }).session(session).lean(),
    data.subCategoryId ? Category.findOne({ _id: data.subCategoryId, companyId }).session(session).lean() : null,
    data.brandId ? Brand.findOne({ _id: data.brandId, companyId }).session(session).lean() : null,
  ]);
  if (!cat) throw ApiError.badRequest('Category not found');
  if (data.subCategoryId && (!sub || String(sub.parentId) !== String(cat._id))) throw ApiError.badRequest('Sub-category does not belong to the selected category');
  if (data.brandId && !brand) throw ApiError.badRequest('Brand not found');
  return { cat, sub, brand };
}

function denorm(product, refs) {
  return {
    productName: product.name, productCode: product.productCode, categoryId: product.categoryId, categoryName: refs.cat.name,
    subCategoryId: product.subCategoryId, brandId: product.brandId, brandName: refs.brand?.name || '',
    gender: product.gender, season: product.season, gstRate: product.gstRate, hsnCode: product.hsnCode, unit: product.unit,
  };
}

function checkPrices(p, label = '') {
  if (p.mrp != null && p.sellingPrice != null && Number(p.sellingPrice) > Number(p.mrp)) {
    throw ApiError.badRequest(`${label}Selling price cannot be greater than MRP`);
  }
}

async function uniqueSku(companyId, base, taken, session) {
  let sku = base;
  let i = 1;
  // eslint-disable-next-line no-await-in-loop
  while (taken.has(sku) || (await ProductVariant.exists({ companyId, sku }).session(session))) {
    i += 1;
    sku = `${base}-${i}`;
  }
  taken.add(sku);
  return sku;
}

/** Validates variant list (duplicates within the payload) */
function checkVariantPayload(variants) {
  if (!variants?.length) throw ApiError.badRequest('At least one variant (size / color) is required');
  const combos = new Set();
  const skus = new Set();
  const codes = new Set();
  variants.forEach((v) => {
    const k = comboKey(v);
    if (combos.has(k)) throw ApiError.badRequest(`Duplicate variant: ${[v.color, v.size].filter(Boolean).join(' / ') || 'default'}`);
    combos.add(k);
    if (v.sku) {
      const s = v.sku.toUpperCase();
      if (skus.has(s)) throw ApiError.badRequest(`Duplicate SKU in variants: ${s}`);
      skus.add(s);
    }
    if (v.barcode) {
      if (codes.has(v.barcode)) throw ApiError.badRequest(`Duplicate barcode in variants: ${v.barcode}`);
      codes.add(v.barcode);
    }
    checkPrices(v, `${v.color || ''} ${v.size || ''}: `.trimStart());
  });
}

async function buildVariant(req, session, product, refs, v, takenSkus) {
  const sku = v.sku
    ? v.sku.toUpperCase()
    : await uniqueSku(req.companyId, [product.productCode, slug(v.color, 3), slug(v.size, 4)].filter(Boolean).join('-'), takenSkus, session);
  if (v.sku) {
    if (await ProductVariant.exists({ companyId: req.companyId, sku, _id: { $ne: v._id } }).session(session)) throw ApiError.conflict(`Duplicate SKU "${sku}"`);
  }
  let code = v.barcode?.trim();
  let format = v.barcodeFormat;
  let source = 'manual';
  if (code) {
    format = format || detectFormat(code);
    await barcodeService.assertAvailable(req.companyId, code, format, { session });
  } else {
    const bc = await barcodeService.allocate(req.companyId, session, v.barcodeFormat);
    code = bc.code;
    format = bc.format;
    source = 'auto';
  }
  const doc = {
    companyId: req.companyId, productId: product._id, sku, barcode: code, barcodeFormat: format,
    size: v.size || '', color: v.color || '',
    fabric: v.fabric || product.fabric, pattern: v.pattern || product.pattern, style: v.style || product.style,
    purchasePrice: v.purchasePrice ?? product.purchasePrice,
    sellingPrice: v.sellingPrice ?? product.sellingPrice,
    mrp: v.mrp ?? product.mrp,
    reorderLevel: v.reorderLevel || 0,
    status: v.status || 'active',
    ...denorm(product, refs),
  };
  checkPrices(doc, `${sku}: `);
  doc.searchText = ProductVariant.buildSearchText(doc);
  const [created] = await ProductVariant.create([doc], { session });
  await barcodeService.register(req.companyId, created, { code, format, source, session });
  return created;
}

async function create(req, data) {
  checkPrices(data);
  checkVariantPayload(data.variants);
  const result = await runInTransaction(async (session) => {
    const refs = await resolveRefs(req.companyId, data, session);
    const productCode = data.productCode.toUpperCase();
    const [product] = await Product.create([{
      ...pick(data, PRODUCT_FIELDS), productCode, companyId: req.companyId, createdBy: req.user._id,
      variantCount: data.variants.length,
    }], { session });
    const taken = new Set();
    const variants = [];
    for (const v of data.variants) {
      // eslint-disable-next-line no-await-in-loop
      const created = await buildVariant(req, session, product, refs, v, taken);
      variants.push(created);
      if (v.openingStock > 0) {
        const branchId = data.openingStockBranchId || req.branchId;
        if (!branchId) throw ApiError.badRequest('Select a branch for opening stock');
        // eslint-disable-next-line no-await-in-loop
        await stockService.applyMovement({
          session, companyId: req.companyId, branchId, variant: created, qty: Number(v.openingStock), type: 'opening',
          refType: 'Product', refId: product._id, refNo: product.productCode, userId: req.user._id,
          costPrice: created.purchasePrice, note: 'Opening stock on product creation',
        });
      }
    }
    return { product, variants };
  });
  await audit.log(req, { action: 'product.create', entity: 'Product', entityId: result.product._id, refNo: result.product.productCode, newValue: { ...result.product.toObject(), variants: result.variants.map((v) => ({ sku: v.sku, barcode: v.barcode, size: v.size, color: v.color })) } });
  return get(req, result.product._id);
}

async function update(req, id, data) {
  if (data.variants) checkVariantPayload(data.variants);
  const before = await get(req, id);
  const priceChanges = [];
  await runInTransaction(async (session) => {
    const product = await Product.findOne({ _id: id, companyId: req.companyId, deletedAt: null }).session(session);
    if (!product) throw ApiError.notFound('Product not found');
    const productPricesChanged = PRICE_FIELDS.some((f) => data[f] != null && Number(data[f]) !== Number(product[f]));
    if (productPricesChanged && !req.perms.has('sale.price_change') && !req.perms.has('product.edit')) throw ApiError.forbidden('Not allowed to change prices');
    Object.assign(product, pick(data, PRODUCT_FIELDS));
    checkPrices(product);
    if (data.productCode && data.productCode.toUpperCase() !== product.productCode) product.productCode = data.productCode.toUpperCase();
    const refs = await resolveRefs(req.companyId, product, session);
    const common = denorm(product, refs);

    const existing = await ProductVariant.find({ productId: id, deletedAt: null }).session(session);
    const byId = new Map(existing.map((v) => [String(v._id), v]));
    const taken = new Set();
    const keep = new Set();

    for (const v of data.variants || existing.map((e) => ({ _id: e._id }))) {
      const cur = v._id && byId.get(String(v._id));
      if (cur) {
        keep.add(String(cur._id));
        const old = pick(cur.toObject(), PRICE_FIELDS);
        VARIANT_ATTRS.forEach((k) => { if (v[k] !== undefined) cur[k] = v[k]; });
        PRICE_FIELDS.forEach((k) => {
          if (v[k] != null) cur[k] = v[k];
          else if (data.applyPricesToVariants && data[k] != null) cur[k] = data[k];
        });
        if (v.reorderLevel != null) cur.reorderLevel = v.reorderLevel;
        if (v.status) cur.status = v.status;
        if (v.sku && v.sku.toUpperCase() !== cur.sku) {
          const sku = v.sku.toUpperCase();
          if (await ProductVariant.exists({ companyId: req.companyId, sku, _id: { $ne: cur._id } }).session(session)) throw ApiError.conflict(`Duplicate SKU "${sku}"`);
          cur.sku = sku;
        }
        if (v.barcode && v.barcode !== cur.barcode) {
          const format = v.barcodeFormat || detectFormat(v.barcode);
          await barcodeService.assertAvailable(req.companyId, v.barcode, format, { session, exceptVariantId: cur._id });
          await barcodeService.reassign(req.companyId, cur, { code: v.barcode, format, source: 'manual', session });
          cur.barcode = v.barcode;
          cur.barcodeFormat = format;
        }
        Object.assign(cur, common);
        checkPrices(cur, `${cur.sku}: `);
        cur.searchText = ProductVariant.buildSearchText(cur);
        await cur.save({ session });
        const now = pick(cur.toObject(), PRICE_FIELDS);
        if (PRICE_FIELDS.some((k) => Number(old[k]) !== Number(now[k]))) priceChanges.push({ sku: cur.sku, old, new: now });
      } else {
        await buildVariant(req, session, product, refs, v, taken);
      }
    }
    // removed variants: hard delete if never used, else soft delete (must have zero stock)
    if (data.variants) {
      for (const v of existing) {
        if (keep.has(String(v._id))) continue;
        const stockQty = await Stock.aggregate([{ $match: { variantId: v._id } }, { $group: { _id: null, q: { $sum: '$current' } } }]).session(session);
        if ((stockQty[0]?.q || 0) !== 0) throw ApiError.badRequest(`Cannot remove variant ${v.sku}: it has stock (${stockQty[0].q})`);
        const used = await SaleItem.exists({ variantId: v._id }).session(session) || await Stock.exists({ variantId: v._id }).session(session);
        if (used) {
          v.deletedAt = new Date();
          v.status = 'inactive';
          await v.save({ session });
        } else {
          await Barcode.deleteMany({ variantId: v._id }, { session });
          await v.deleteOne({ session });
        }
      }
    }
    product.variantCount = await ProductVariant.countDocuments({ productId: id, deletedAt: null }).session(session);
    await product.save({ session });
  });
  const after = await get(req, id);
  await audit.log(req, { action: 'product.update', entity: 'Product', entityId: id, refNo: after.productCode, oldValue: before, newValue: after });
  const productPriceChanged = PRICE_FIELDS.some((k) => Number(before[k]) !== Number(after[k]));
  if (priceChanges.length || productPriceChanged) {
    await audit.log(req, {
      action: 'product.price_change', entity: 'Product', entityId: id, refNo: after.productCode,
      oldValue: { ...pick(before, PRICE_FIELDS), variants: priceChanges.map((p) => ({ sku: p.sku, ...p.old })) },
      newValue: { ...pick(after, PRICE_FIELDS), variants: priceChanges.map((p) => ({ sku: p.sku, ...p.new })) },
    });
  }
  return after;
}

async function remove(req, id) {
  const product = await Product.findOne({ _id: id, companyId: req.companyId, deletedAt: null });
  if (!product) throw ApiError.notFound('Product not found');
  const [stock] = await Stock.aggregate([{ $match: { productId: product._id } }, { $group: { _id: null, q: { $sum: '$current' } } }]);
  if ((stock?.q || 0) > 0) throw ApiError.badRequest(`Product has ${stock.q} units in stock. Adjust stock to zero before deleting.`);
  await runInTransaction(async (session) => {
    product.deletedAt = new Date();
    product.status = 'inactive';
    await product.save({ session });
    await ProductVariant.updateMany({ productId: id }, { $set: { deletedAt: new Date(), status: 'inactive' } }, { session });
  });
  await audit.log(req, { action: 'product.delete', entity: 'Product', entityId: id, refNo: product.productCode, oldValue: product.toObject() });
}

async function get(req, id) {
  const product = await Product.findOne({ _id: id, companyId: req.companyId, deletedAt: null })
    .populate('categoryId', 'name').populate('subCategoryId', 'name').populate('brandId', 'name').populate('supplierId', 'name').lean();
  if (!product) throw ApiError.notFound('Product not found');
  const variants = await ProductVariant.find({ productId: id, deletedAt: null }).sort({ _id: 1 }).lean();
  const stockMatch = { productId: product._id, ...(req.branchId ? { branchId: req.branchId } : {}) };
  const stock = await Stock.aggregate([{ $match: stockMatch }, { $group: { _id: '$variantId', current: { $sum: '$current' } } }]);
  const sm = new Map(stock.map((s) => [String(s._id), s.current]));
  return {
    ...product,
    categoryName: product.categoryId?.name, brandName: product.brandId?.name,
    categoryId: product.categoryId?._id, subCategoryId: product.subCategoryId?._id, brandId: product.brandId?._id, supplierId: product.supplierId?._id,
    supplierName: product.supplierId?.name,
    variants: variants.map(({ searchText, ...v }) => ({ ...v, stock: sm.get(String(v._id)) || 0 })),
  };
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, deletedAt: null };
  if (q.categoryId) filter.$or = [{ categoryId: q.categoryId }, { subCategoryId: q.categoryId }];
  if (q.brandId) filter.brandId = q.brandId;
  if (q.status) filter.status = q.status;
  if (q.gender) filter.gender = q.gender;
  if (q.search) {
    const s = String(q.search).trim();
    // barcode / SKU hits resolve through the indexed variant collection
    const vHits = await ProductVariant.find({ companyId: req.companyId, $or: [{ barcode: s }, { sku: s.toUpperCase() }] }).select('productId').limit(50).lean();
    const rx = new RegExp(escapeRegex(s), 'i');
    const or = [{ name: rx }, { productCode: s.toUpperCase() }, { _id: { $in: vHits.map((v) => v.productId) } }];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: or }];
      delete filter.$or;
    } else filter.$or = or;
  }
  const res = await paginate(Product, filter, q, {
    populate: [{ path: 'categoryId', select: 'name' }, { path: 'brandId', select: 'name' }],
  });
  const ids = res.items.map((p) => p._id);
  const stockMatch = { productId: { $in: ids }, ...(req.branchId ? { branchId: req.branchId } : { companyId: req.companyId }) };
  const stock = await Stock.aggregate([{ $match: stockMatch }, { $group: { _id: '$productId', current: { $sum: '$current' } } }]);
  const sm = new Map(stock.map((s) => [String(s._id), s.current]));
  res.items = res.items.map((p) => ({ ...p, categoryName: p.categoryId?.name, brandName: p.brandId?.name, stock: sm.get(String(p._id)) || 0 }));
  return res;
}

/** Fast variant search for POS / purchase / transfer screens (never loads whole catalogue). */
async function searchVariants(req) {
  const q = req.query;
  const s = String(q.q || q.search || '').trim();
  const limit = Math.min(50, Number(q.limit) || 20);
  const filter = { companyId: req.companyId, deletedAt: null };
  if (q.includeInactive !== 'true') filter.status = 'active';
  if (q.productId) filter.productId = q.productId;
  if (q.categoryId) filter.categoryId = q.categoryId;
  let variants = [];
  if (s) {
    variants = await ProductVariant.find({ ...filter, $or: [{ barcode: s }, { sku: s.toUpperCase() }] }).limit(limit).lean();
    if (!variants.length) {
      // every word must match (e.g. "black tee l")
      const words = s.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
      variants = await ProductVariant.find({ ...filter, $and: words.map((w) => ({ searchText: { $regex: escapeRegex(w) } })) })
        .sort({ productName: 1, color: 1, _id: 1 }).limit(limit).lean();
    }
  } else {
    variants = await ProductVariant.find(filter).sort({ updatedAt: -1 }).limit(limit).lean();
  }
  const branchId = q.branchId ? new mongoose.Types.ObjectId(q.branchId) : req.branchId;
  if (branchId) {
    const sm = await stockService.getStockMap(branchId, variants.map((v) => v._id));
    variants = variants.map((v) => ({ ...v, stock: sm.get(String(v._id))?.current || 0, avgCost: sm.get(String(v._id))?.avgCost || 0 }));
  }
  return variants.map(({ searchText, ...v }) => v);
}

/** Paginated variant list (for Variants & barcode screens). */
async function listVariants(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, deletedAt: null };
  if (q.search) {
    const s = String(q.search).trim();
    filter.$or = [{ barcode: s }, { sku: s.toUpperCase() }, { searchText: { $regex: escapeRegex(s.toLowerCase()) } }];
  }
  if (q.categoryId) filter.categoryId = q.categoryId;
  if (q.productId) filter.productId = q.productId;
  if (q.size) filter.size = q.size;
  if (q.color) filter.color = new RegExp(`^${escapeRegex(q.color)}$`, 'i');
  const res = await paginate(ProductVariant, filter, q, { defaultSort: { productName: 1, color: 1, _id: 1 }, select: '-searchText' });
  if (req.branchId) {
    const sm = await stockService.getStockMap(req.branchId, res.items.map((v) => v._id));
    res.items = res.items.map((v) => ({ ...v, stock: sm.get(String(v._id))?.current || 0 }));
  }
  return res;
}

module.exports = { create, update, remove, get, list, searchVariants, listVariants };
