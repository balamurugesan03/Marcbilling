const { Purchase, PurchaseItem, PurchaseReturn, Supplier, ProductVariant, Branch, Payment } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, dateRange, escapeRegex, round2 } = require('../utils/common');
const { runInTransaction } = require('../utils/transaction');
const { computeTotals, isInterState } = require('../utils/gst');
const { assertBranchAccess } = require('../middleware/auth');
const settingsService = require('./settings.service');
const stockService = require('./stock.service');
const paymentService = require('./payment.service');
const audit = require('./audit.service');

async function buildLines(req, data, session) {
  const settings = await settingsService.get(req.companyId);
  const [supplier, branch] = await Promise.all([
    Supplier.findOne({ _id: data.supplierId, companyId: req.companyId }).session(session).lean(),
    Branch.findOne({ _id: data.branchId, companyId: req.companyId }).session(session).lean(),
  ]);
  if (!supplier) throw ApiError.badRequest('Supplier not found');
  if (!branch) throw ApiError.badRequest('Branch not found');
  const ids = data.items.map((i) => i.variantId);
  const variants = await ProductVariant.find({ _id: { $in: ids }, companyId: req.companyId, deletedAt: null }).session(session).lean();
  const vm = new Map(variants.map((v) => [String(v._id), v]));
  const seen = new Set();
  const raw = data.items.map((it) => {
    const v = vm.get(String(it.variantId));
    if (!v) throw ApiError.badRequest('One or more products were not found');
    if (seen.has(String(v._id))) throw ApiError.badRequest(`${v.sku} is added more than once`);
    seen.add(String(v._id));
    if (!(it.qty > 0)) throw ApiError.badRequest(`Quantity for ${v.sku} must be greater than zero`);
    if (it.sellingPrice != null && it.mrp != null && it.sellingPrice > it.mrp) throw ApiError.badRequest(`${v.sku}: selling price cannot exceed MRP`);
    return {
      variantId: v._id, productId: v.productId, productName: v.productName, sku: v.sku, barcode: v.barcode,
      size: v.size, color: v.color, hsnCode: v.hsnCode, qty: it.qty, rate: it.rate,
      discount: it.discount || 0, discountPercent: it.discountPercent || 0,
      gstRate: it.gstRate ?? v.gstRate, mrp: it.mrp ?? v.mrp, sellingPrice: it.sellingPrice ?? v.sellingPrice,
    };
  });
  const interState = isInterState({ mode: settings.tax.mode }, branch, { stateCode: supplier.stateCode, gstNumber: supplier.gstin });
  const taxInclusive = settings.tax.purchaseTaxInclusive;
  const { lines, totals } = computeTotals(raw, { taxInclusive, interState, billDiscount: data.billDiscount || 0 });
  return { supplier, lines, totals, interState, taxInclusive };
}

function itemDocs(req, purchase, lines) {
  return lines.map((l) => ({
    companyId: req.companyId, branchId: purchase.branchId, purchaseId: purchase._id, supplierId: purchase.supplierId,
    variantId: l.variantId, productId: l.productId, productName: l.productName, sku: l.sku, barcode: l.barcode,
    size: l.size, color: l.color, hsnCode: l.hsnCode, qty: l.qty, rate: l.rate, discount: l.discountTotal, gstRate: l.gstRate,
    taxable: l.taxable, cgst: l.cgst, sgst: l.sgst, igst: l.igst, taxAmount: l.taxAmount, amount: l.amount,
    mrp: l.mrp, sellingPrice: l.sellingPrice, status: purchase.status, invoiceDate: purchase.invoiceDate,
  }));
}

/** Receiving: increases branch stock, updates cost / prices and supplier payable. */
async function receiveInternal(session, req, purchase, { updatePrices = true } = {}) {
  const items = await PurchaseItem.find({ purchaseId: purchase._id }).session(session);
  for (const it of items) {
    const variant = await ProductVariant.findById(it.variantId).session(session);
    const unitCost = round2(it.taxable / it.qty); // cost excluding GST (input credit)
    await stockService.applyMovement({
      session, companyId: req.companyId, branchId: purchase.branchId, variant, qty: it.qty, type: 'purchase',
      refType: 'Purchase', refId: purchase._id, refNo: purchase.purchaseNo, userId: req.user._id, costPrice: unitCost,
      note: `Supplier invoice ${purchase.invoiceNumber}`,
    });
    if (updatePrices) {
      variant.purchasePrice = unitCost;
      if (it.mrp) variant.mrp = it.mrp;
      if (it.sellingPrice) variant.sellingPrice = it.sellingPrice;
      await variant.save({ session });
    }
    it.status = 'received';
    await it.save({ session });
  }
  purchase.status = 'received';
  purchase.receivedBy = req.user._id;
  purchase.receivedAt = new Date();
  purchase.dueAmount = round2(purchase.totals.grandTotal - purchase.paidAmount);
  await purchase.save({ session });
  await Supplier.updateOne({ _id: purchase.supplierId }, { $inc: { balance: purchase.totals.grandTotal } }, { session });
}

async function create(req, data) {
  assertBranchAccess(req, data.branchId);
  const result = await runInTransaction(async (session) => {
    if (await Purchase.exists({ companyId: req.companyId, supplierId: data.supplierId, invoiceNumber: data.invoiceNumber }).session(session)) {
      throw ApiError.conflict(`Supplier invoice ${data.invoiceNumber} is already entered`);
    }
    const { supplier, lines, totals, interState, taxInclusive } = await buildLines(req, data, session);
    const purchaseNo = await settingsService.nextNumber(req.companyId, 'purchase', { branchId: data.branchId, session });
    const [purchase] = await Purchase.create([{
      companyId: req.companyId, branchId: data.branchId, purchaseNo, supplierId: supplier._id, supplierName: supplier.name,
      invoiceNumber: data.invoiceNumber, invoiceDate: data.invoiceDate, status: 'draft', interState, taxInclusive,
      totals, itemCount: lines.length, dueAmount: totals.grandTotal, notes: data.notes, createdBy: req.user._id,
    }], { session });
    await PurchaseItem.insertMany(itemDocs(req, purchase, lines), { session });
    if (data.status === 'received') await receiveInternal(session, req, purchase, { updatePrices: data.updatePrices !== false });
    if (data.payment?.amount > 0) {
      if (purchase.status !== 'received') throw ApiError.badRequest('Receive the purchase before recording payment');
      if (data.payment.amount > totals.grandTotal) throw ApiError.badRequest('Payment exceeds purchase total');
      const r = { ...req, branchId: purchase.branchId };
      await paymentService.supplierPayment(r, { supplierId: supplier._id, purchaseId: purchase._id, ...data.payment }, session);
    }
    return purchase;
  });
  await audit.log(req, { action: 'purchase.create', entity: 'Purchase', entityId: result._id, refNo: result.purchaseNo, branchId: result.branchId, newValue: { ...result.toObject(), status: data.status } });
  return get(req, result._id);
}

async function updateDraft(req, id, data) {
  const before = await get(req, id);
  if (before.status !== 'draft') throw ApiError.badRequest('Only draft purchases can be edited');
  assertBranchAccess(req, data.branchId);
  await runInTransaction(async (session) => {
    const purchase = await Purchase.findById(id).session(session);
    const { supplier, lines, totals, interState, taxInclusive } = await buildLines(req, data, session);
    Object.assign(purchase, {
      branchId: data.branchId, supplierId: supplier._id, supplierName: supplier.name, invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate, interState, taxInclusive, totals, itemCount: lines.length, dueAmount: totals.grandTotal, notes: data.notes,
    });
    await purchase.save({ session });
    await PurchaseItem.deleteMany({ purchaseId: id }, { session });
    await PurchaseItem.insertMany(itemDocs(req, purchase, lines), { session });
    if (data.status === 'received') await receiveInternal(session, req, purchase, { updatePrices: data.updatePrices !== false });
  });
  const after = await get(req, id);
  await audit.log(req, { action: 'purchase.update', entity: 'Purchase', entityId: id, refNo: after.purchaseNo, oldValue: before, newValue: after });
  return after;
}

async function receive(req, id, { updatePrices } = {}) {
  await runInTransaction(async (session) => {
    const purchase = await Purchase.findOne({ _id: id, companyId: req.companyId }).session(session);
    if (!purchase) throw ApiError.notFound('Purchase not found');
    assertBranchAccess(req, purchase.branchId);
    if (purchase.status !== 'draft') throw ApiError.badRequest(`Purchase is already ${purchase.status}`);
    await receiveInternal(session, req, purchase, { updatePrices: updatePrices !== false });
  });
  const after = await get(req, id);
  await audit.log(req, { action: 'purchase.receive', entity: 'Purchase', entityId: id, refNo: after.purchaseNo, branchId: after.branchId, newValue: { status: 'received', totals: after.totals } });
  return after;
}

async function cancel(req, id, reason) {
  const purchase = await Purchase.findOne({ _id: id, companyId: req.companyId });
  if (!purchase) throw ApiError.notFound('Purchase not found');
  assertBranchAccess(req, purchase.branchId);
  if (purchase.status !== 'draft') throw ApiError.badRequest('Only draft purchases can be cancelled. Use Purchase Return for received goods.');
  purchase.status = 'cancelled';
  purchase.cancelledAt = new Date();
  purchase.notes = [purchase.notes, `Cancelled: ${reason || ''}`].filter(Boolean).join('\n');
  await purchase.save();
  await PurchaseItem.updateMany({ purchaseId: id }, { status: 'cancelled' });
  await audit.log(req, { action: 'purchase.cancel', entity: 'Purchase', entityId: id, refNo: purchase.purchaseNo, newValue: { reason } });
  return purchase;
}

async function get(req, id) {
  const p = await Purchase.findOne({ _id: id, companyId: req.companyId }).populate('branchId', 'name code').populate('createdBy', 'name').lean();
  if (!p) throw ApiError.notFound('Purchase not found');
  if (req.allowedBranchIds && !req.allowedBranchIds.includes(String(p.branchId._id))) throw ApiError.forbidden();
  const [items, returns, payments] = await Promise.all([
    PurchaseItem.find({ purchaseId: id }).lean(),
    PurchaseReturn.find({ purchaseId: id }).sort({ createdAt: -1 }).lean(),
    Payment.find({ refId: id, type: 'supplier_payment' }).sort({ date: -1 }).lean(),
  ]);
  return { ...p, branchName: p.branchId.name, branchId: p.branchId._id, items, returns, payments };
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to, 'invoiceDate') };
  if (q.supplierId) filter.supplierId = q.supplierId;
  if (q.status) filter.status = q.status;
  if (q.paymentStatus) filter.paymentStatus = q.paymentStatus;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ purchaseNo: rx }, { invoiceNumber: rx }, { supplierName: rx }];
  }
  return paginate(Purchase, filter, q, { populate: { path: 'branchId', select: 'name' } });
}

/** Purchase return: decreases stock and supplier payable (or records a refund). */
async function createReturn(req, data) {
  const result = await runInTransaction(async (session) => {
    const purchase = await Purchase.findOne({ _id: data.purchaseId, companyId: req.companyId }).session(session);
    if (!purchase) throw ApiError.notFound('Purchase not found');
    assertBranchAccess(req, purchase.branchId);
    if (purchase.status !== 'received') throw ApiError.badRequest('Only received purchases can be returned');
    const pItems = await PurchaseItem.find({ purchaseId: purchase._id }).session(session);
    const pm = new Map(pItems.map((i) => [String(i._id), i]));
    const lines = [];
    for (const r of data.items) {
      if (!(r.qty > 0)) continue;
      const it = pm.get(String(r.purchaseItemId));
      if (!it) throw ApiError.badRequest('Item does not belong to this purchase');
      const max = it.qty - it.returnedQty;
      if (r.qty > max) throw ApiError.badRequest(`Return qty for ${it.sku} exceeds purchased qty (max ${max})`);
      const f = r.qty / it.qty;
      const line = {
        purchaseItemId: it._id, variantId: it.variantId, productId: it.productId, productName: it.productName, sku: it.sku, barcode: it.barcode,
        size: it.size, color: it.color, hsnCode: it.hsnCode, qty: r.qty, rate: it.rate, discount: round2(it.discount * f), gstRate: it.gstRate,
        taxable: round2(it.taxable * f), cgst: round2(it.cgst * f), sgst: round2(it.sgst * f), igst: round2(it.igst * f),
        taxAmount: round2(it.taxAmount * f), amount: round2(it.amount * f),
      };
      lines.push(line);
      it.returnedQty += r.qty;
      await it.save({ session });
    }
    if (!lines.length) throw ApiError.badRequest('Enter return quantity for at least one item');
    const amount = round2(lines.reduce((a, l) => a + l.amount, 0));
    const returnNo = await settingsService.nextNumber(req.companyId, 'purchaseReturn', { branchId: purchase.branchId, session });
    const [ret] = await PurchaseReturn.create([{
      companyId: req.companyId, branchId: purchase.branchId, returnNo, purchaseId: purchase._id, purchaseNo: purchase.purchaseNo,
      supplierId: purchase.supplierId, supplierName: purchase.supplierName, items: lines, totalQty: lines.reduce((a, l) => a + l.qty, 0),
      taxable: round2(lines.reduce((a, l) => a + l.taxable, 0)), totalTax: round2(lines.reduce((a, l) => a + l.taxAmount, 0)), amount,
      settlement: data.settlement || 'adjust', refundMode: data.refundMode, reason: data.reason, createdBy: req.user._id,
    }], { session });
    for (const l of lines) {
      const variant = await ProductVariant.findById(l.variantId).session(session);
      await stockService.applyMovement({
        session, companyId: req.companyId, branchId: purchase.branchId, variant, qty: -l.qty, type: 'purchase_return',
        refType: 'PurchaseReturn', refId: ret._id, refNo: returnNo, userId: req.user._id, allowNegative: false, note: data.reason,
      });
    }
    if ((data.settlement || 'adjust') === 'adjust') {
      purchase.returnedAmount = round2(purchase.returnedAmount + amount);
      purchase.dueAmount = round2(Math.max(0, purchase.totals.grandTotal - purchase.paidAmount - purchase.returnedAmount));
      if (purchase.dueAmount <= 0) purchase.paymentStatus = 'paid';
      await purchase.save({ session });
      await Supplier.updateOne({ _id: purchase.supplierId }, { $inc: { balance: -amount } }, { session });
    } else {
      if (!['cash', 'card', 'upi', 'bank'].includes(data.refundMode)) throw ApiError.badRequest('Select refund mode');
      await paymentService.record(session, req, {
        branchId: purchase.branchId, direction: 'in', type: 'supplier_refund', mode: data.refundMode, amount,
        partyType: 'supplier', partyId: purchase.supplierId, partyName: purchase.supplierName, refType: 'PurchaseReturn', refId: ret._id, refNo: returnNo,
      });
    }
    return ret;
  });
  await audit.log(req, { action: 'purchase.return', entity: 'PurchaseReturn', entityId: result._id, refNo: result.returnNo, branchId: result.branchId, newValue: result.toObject() });
  return result;
}

async function listReturns(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to) };
  if (q.supplierId) filter.supplierId = q.supplierId;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ returnNo: rx }, { purchaseNo: rx }, { supplierName: rx }];
  }
  return paginate(PurchaseReturn, filter, q, { populate: { path: 'branchId', select: 'name' } });
}

module.exports = { create, updateDraft, receive, cancel, get, list, createReturn, listReturns };
