const { Barcode, ProductVariant, Product, Category, Stock } = require('../models');
const ApiError = require('../utils/ApiError');
const { validateBarcode, buildBarcode, detectFormat } = require('../utils/barcode');
const settingsService = require('./settings.service');
const audit = require('./audit.service');

/**
 * Allocates a new unique auto barcode for the company (skips codes already taken manually).
 * Accessories use their own prefix + sequence so they never mix with dress barcodes.
 */
async function allocate(companyId, session, format, { accessory = false } = {}) {
  const settings = await settingsService.get(companyId);
  const b = settings.barcode || {};
  const cfg = {
    ...b,
    defaultFormat: format || b.defaultFormat,
    ean13Prefix: accessory ? (b.accessoryEan13Prefix || '890124') : b.ean13Prefix,
    code128Prefix: accessory ? (b.accessoryCode128Prefix || 'AC') : b.code128Prefix,
  };
  for (let i = 0; i < 50; i += 1) {
    const prefix = cfg.defaultFormat === 'EAN13' ? cfg.ean13Prefix : cfg.code128Prefix;
    const seq = await settingsService.nextSeq(`${companyId}:barcode:${cfg.defaultFormat}:${prefix}`, session);
    const bc = buildBarcode(seq, cfg);
    if (!(await Barcode.exists({ companyId, code: bc.code }).session(session))) return bc;
  }
  throw ApiError.conflict('Could not allocate a unique barcode; check barcode settings');
}

/** True when the product's category or sub-category is marked as Accessory. */
async function isAccessoryProduct(companyId, product, session) {
  const ids = [product.categoryId, product.subCategoryId].filter(Boolean);
  if (!ids.length) return false;
  return !!(await Category.exists({ companyId, _id: { $in: ids }, isAccessory: true }).session(session));
}

/** Validates a manual barcode and ensures it is not used by another variant. */
async function assertAvailable(companyId, code, format, { session, exceptVariantId } = {}) {
  const err = validateBarcode(code, format || detectFormat(code));
  if (err) throw ApiError.badRequest(err);
  const existing = await Barcode.findOne({ companyId, code }).session(session).lean();
  if (existing && String(existing.variantId) !== String(exceptVariantId || '')) {
    const v = await ProductVariant.findById(existing.variantId).select('productName sku size color').lean();
    throw ApiError.conflict(`Duplicate barcode ${code}: already assigned to ${v ? `${v.productName} ${v.size || ''} ${v.color || ''} (${v.sku})` : 'another item'}`);
  }
}

async function register(companyId, variant, { code, format, source, session }) {
  await Barcode.create([{ companyId, code, format, variantId: variant._id, productId: variant.productId, isPrimary: true, source }], { session });
}

/** Replaces the primary barcode of a variant. */
async function reassign(companyId, variant, { code, format, source, session }) {
  await Barcode.updateMany({ companyId, variantId: variant._id, isPrimary: true }, { $set: { isPrimary: false } }, { session });
  const existing = await Barcode.findOne({ companyId, code }).session(session);
  if (existing) {
    existing.isPrimary = true;
    await existing.save({ session });
  } else {
    await register(companyId, variant, { code, format, source, session });
  }
  // the old code stays in the registry as an alternate barcode, so previously printed labels still scan
}

/** Barcode scan lookup -> exact variant (+ stock in branch). */
async function lookup(req, code) {
  const c = String(code || '').trim();
  if (!c) throw ApiError.badRequest('Barcode is required');
  let variant = await ProductVariant.findOne({ companyId: req.companyId, barcode: c, deletedAt: null }).lean();
  if (!variant) {
    const reg = await Barcode.findOne({ companyId: req.companyId, code: c }).lean();
    if (reg) variant = await ProductVariant.findOne({ _id: reg.variantId, deletedAt: null }).lean();
  }
  if (!variant) variant = await ProductVariant.findOne({ companyId: req.companyId, sku: c.toUpperCase(), deletedAt: null }).lean();
  if (!variant) throw ApiError.notFound('Product Not Found');
  if (variant.status !== 'active') throw ApiError.badRequest(`${variant.productName} (${variant.sku}) is inactive`);
  let stock = null;
  if (req.branchId) {
    const s = await Stock.findOne({ branchId: req.branchId, variantId: variant._id }).lean();
    stock = s?.current || 0;
  }
  delete variant.searchText;
  return { ...variant, stock };
}

async function validate(req, { code, format, variantId }) {
  const fmt = format || detectFormat(code);
  const err = validateBarcode(code, fmt);
  if (err) return { valid: false, format: fmt, message: err };
  const existing = await Barcode.findOne({ companyId: req.companyId, code }).lean();
  if (existing && String(existing.variantId) !== String(variantId || '')) {
    return { valid: false, format: fmt, exists: true, message: 'Barcode already exists' };
  }
  return { valid: true, format: fmt, message: 'Barcode is valid and available' };
}

/** Bulk (re)generation of auto barcodes for selected variants. */
async function bulkGenerate(req, { variantIds, format }) {
  const { runInTransaction } = require('../utils/transaction');
  const results = await runInTransaction(async (session) => {
    const variants = await ProductVariant.find({ _id: { $in: variantIds }, companyId: req.companyId, deletedAt: null }).session(session);
    const out = [];
    const accessoryByProduct = new Map();
    for (const v of variants) {
      const pid = String(v.productId);
      if (!accessoryByProduct.has(pid)) {
        const p = await Product.findById(v.productId).select('categoryId subCategoryId').session(session).lean();
        accessoryByProduct.set(pid, p ? await isAccessoryProduct(req.companyId, p, session) : false);
      }
      const bc = await allocate(req.companyId, session, format, { accessory: accessoryByProduct.get(pid) });
      const old = v.barcode;
      await reassign(req.companyId, v, { code: bc.code, format: bc.format, source: 'auto', session });
      v.barcode = bc.code;
      v.barcodeFormat = bc.format;
      v.searchText = ProductVariant.buildSearchText(v);
      await v.save({ session });
      out.push({ variantId: v._id, sku: v.sku, old, barcode: bc.code });
    }
    return out;
  });
  await audit.log(req, { action: 'barcode.bulk_generate', entity: 'Barcode', newValue: results });
  return results;
}

/** Returns label data for printing and records print counts. items: [{ variantId, qty }] */
async function labels(req, { items }) {
  const ids = items.map((i) => i.variantId);
  const variants = await ProductVariant.find({ _id: { $in: ids }, companyId: req.companyId }).lean();
  const map = new Map(variants.map((v) => [String(v._id), v]));
  const labelsOut = [];
  for (const it of items) {
    const v = map.get(String(it.variantId));
    if (!v) continue;
    const qty = Math.min(500, Math.max(1, Number(it.qty) || 1));
    labelsOut.push({
      variantId: v._id, productName: v.productName, sku: v.sku, size: v.size, color: v.color,
      mrp: v.mrp, sellingPrice: v.sellingPrice, barcode: v.barcode, format: v.barcodeFormat, qty,
    });
    await Barcode.updateOne({ companyId: req.companyId, code: v.barcode }, { $inc: { printedCount: qty }, $set: { lastPrintedAt: new Date() } });
  }
  await audit.log(req, { action: 'barcode.print', entity: 'Barcode', newValue: { labels: labelsOut.reduce((a, l) => a + l.qty, 0) } });
  return labelsOut;
}

module.exports = { allocate, isAccessoryProduct, assertAvailable, register, reassign, lookup, validate, bulkGenerate, labels };
