const { Sale, SaleItem, SaleReturn, Customer } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, dateRange, escapeRegex, round2 } = require('../utils/common');
const { runInTransaction } = require('../utils/transaction');
const settingsService = require('./settings.service');
const stockService = require('./stock.service');
const paymentService = require('./payment.service');
const loyaltyService = require('./loyalty.service');
const audit = require('./audit.service');

function checkPolicy(req, sale, policy, label) {
  if (!policy?.enabled) throw ApiError.badRequest(`${label}s are disabled in settings`);
  const days = (Date.now() - new Date(sale.createdAt).getTime()) / 86400000;
  if (days > policy.days && !req.perms.has('sale.cancel')) {
    throw ApiError.badRequest(`${label} period of ${policy.days} days has expired for invoice ${sale.invoiceNumber}`);
  }
}

/**
 * Creates a sales return inside a transaction. Stock goes back into the CURRENT branch.
 * opts.type = 'exchange' when called by the exchange flow (no money refund here).
 */
async function createReturnInternal(session, req, data, { type = 'return', exchangeId } = {}) {
  const branchId = req.branchId;
  if (!branchId) throw ApiError.badRequest('Select a specific branch');
  const settings = await settingsService.get(req.companyId);
  const sale = await Sale.findOne({ _id: data.saleId, companyId: req.companyId }).session(session);
  if (!sale) throw ApiError.notFound('Original bill not found');
  if (req.allowedBranchIds && !req.allowedBranchIds.includes(String(sale.branchId)) && !req.allowedBranchIds.includes(String(branchId))) throw ApiError.forbidden();
  if (sale.status !== 'completed') throw ApiError.badRequest('Cancelled bills cannot be returned');
  checkPolicy(req, sale, type === 'exchange' ? settings.exchangePolicy : settings.returnPolicy, type === 'exchange' ? 'Exchange' : 'Return');

  const saleItems = await SaleItem.find({ saleId: sale._id }).session(session);
  const sm = new Map(saleItems.map((i) => [String(i._id), i]));
  const lines = [];
  const seen = new Set();
  for (const r of data.items || []) {
    const qty = Number(r.qty);
    if (!qty) continue;
    if (!Number.isInteger(qty) || qty < 0) throw ApiError.badRequest('Return quantity must be a positive whole number');
    if (seen.has(String(r.saleItemId))) throw ApiError.badRequest('Duplicate return line');
    seen.add(String(r.saleItemId));
    const it = sm.get(String(r.saleItemId));
    if (!it) throw ApiError.badRequest('Item does not belong to this bill');
    if (it.qty < 0) throw ApiError.badRequest(`${it.productName} was itself returned on this bill`);
    const max = it.qty - it.returnedQty;
    if (qty > max) throw ApiError.badRequest(`Return qty for ${it.productName} ${it.size || ''} exceeds sold qty (sold ${it.qty}, already returned ${it.returnedQty})`);
    const f = qty / it.qty;
    lines.push({
      saleItemId: it._id, variantId: it.variantId, productId: it.productId, productName: it.productName, sku: it.sku, barcode: it.barcode,
      size: it.size, color: it.color, hsnCode: it.hsnCode, qty, rate: it.rate, discount: round2(it.discount * f), gstRate: it.gstRate,
      taxable: round2(it.taxable * f), cgst: round2(it.cgst * f), sgst: round2(it.sgst * f), igst: round2(it.igst * f),
      taxAmount: round2(it.taxAmount * f), amount: round2(it.amount * f), categoryName: it.categoryName, brandName: it.brandName, costPrice: it.costPrice,
    });
    it.returnedQty += qty;
    await it.save({ session });
  }
  if (!lines.length) throw ApiError.badRequest('Select at least one item and quantity to return');

  const amount = round2(lines.reduce((a, l) => a + l.amount, 0));
  const refundAmount = type === 'exchange' ? amount : Math.round(amount);
  const customer = sale.customerId ? await Customer.findById(sale.customerId).session(session) : null;
  const refundMode = type === 'exchange' ? 'exchange' : data.refundMode || 'cash';
  if (['store_credit', 'adjust_outstanding'].includes(refundMode) && !customer) throw ApiError.badRequest('This bill has no customer; refund in cash/card/UPI');

  const returnNo = await settingsService.nextNumber(req.companyId, 'saleReturn', { branchId, session });
  const cashSessionId = await paymentService.openSessionId(req, branchId, session);
  const [ret] = await SaleReturn.create([{
    companyId: req.companyId, branchId, returnNo, type, exchangeId, saleId: sale._id, invoiceNumber: sale.invoiceNumber,
    customerId: customer?._id, customerName: customer?.name || sale.customer?.name, items: lines,
    totalQty: lines.reduce((a, l) => a + l.qty, 0), taxable: round2(lines.reduce((a, l) => a + l.taxable, 0)),
    cgst: round2(lines.reduce((a, l) => a + l.cgst, 0)), sgst: round2(lines.reduce((a, l) => a + l.sgst, 0)),
    igst: round2(lines.reduce((a, l) => a + l.igst, 0)), totalTax: round2(lines.reduce((a, l) => a + l.taxAmount, 0)),
    costTotal: round2(lines.reduce((a, l) => a + (l.costPrice || 0) * l.qty, 0)),
    amount, roundOff: round2(refundAmount - amount), refundAmount, refundMode,
    refunds: type === 'exchange' ? [] : [{ mode: refundMode === 'adjust_outstanding' ? 'credit' : refundMode, amount: refundAmount }],
    reason: data.reason, createdBy: req.user._id, createdByName: req.user.name, cashSessionId,
  }], { session });

  for (const l of lines) {
    await stockService.applyMovement({
      session, companyId: req.companyId, branchId, variant: { _id: l.variantId, productId: l.productId }, qty: l.qty, type: 'sale_return',
      refType: 'SaleReturn', refId: ret._id, refNo: returnNo, userId: req.user._id, costPrice: l.costPrice, note: `Against ${sale.invoiceNumber}`,
    });
  }

  if (type !== 'exchange') {
    if (['cash', 'card', 'upi', 'bank'].includes(refundMode)) {
      await paymentService.record(session, req, {
        branchId, direction: 'out', type: 'sale_refund', mode: refundMode, amount: refundAmount,
        partyType: customer ? 'customer' : 'none', partyId: customer?._id, partyName: customer?.name, refType: 'SaleReturn', refId: ret._id, refNo: returnNo,
      });
    } else if (refundMode === 'store_credit') {
      customer.storeCredit = round2(customer.storeCredit + refundAmount);
    } else if (refundMode === 'adjust_outstanding') {
      if (refundAmount > round2(customer.outstanding) + 0.001) throw ApiError.badRequest(`Refund exceeds outstanding (₹${round2(customer.outstanding)})`);
      customer.outstanding = round2(customer.outstanding - refundAmount);
      // reduce credit on the bill so the cancellation / receipts logic stays consistent
      sale.creditAmount = round2(Math.max(0, sale.creditAmount - refundAmount));
    } else {
      throw ApiError.badRequest('Invalid refund mode');
    }
  }

  if (customer) {
    customer.totalReturns = round2((customer.totalReturns || 0) + amount);
    await customer.save({ session });
    if (sale.loyaltyEarned > 0 && sale.totals.grandTotal > 0) {
      const reversed = Math.floor((sale.loyaltyEarned * amount) / sale.totals.grandTotal);
      if (reversed > 0) {
        await loyaltyService.add(session, req, customer, -reversed, { type: 'reverse', refType: 'SaleReturn', refId: ret._id, refNo: returnNo, branchId, note: `Return against ${sale.invoiceNumber}`, clamp: true });
        ret.loyaltyReversed = reversed;
        await ret.save({ session });
      }
    }
  }

  sale.returnedAmount = round2(sale.returnedAmount + amount);
  const remaining = saleItems.filter((i) => i.qty > 0).reduce((a, i) => a + (i.qty - i.returnedQty), 0);
  sale.returnStatus = remaining === 0 ? 'full' : 'partial';
  await sale.save({ session });
  return ret;
}

async function create(req, data) {
  const ret = await runInTransaction((session) => createReturnInternal(session, req, data));
  await audit.log(req, { action: 'sale.return', entity: 'SaleReturn', entityId: ret._id, refNo: ret.returnNo, branchId: ret.branchId, newValue: { invoice: ret.invoiceNumber, items: ret.items.map((i) => ({ sku: i.sku, qty: i.qty, amount: i.amount })), refund: ret.refundAmount, mode: ret.refundMode } });
  return ret;
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to) };
  if (q.type) filter.type = q.type;
  if (q.customerId) filter.customerId = q.customerId;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ returnNo: rx }, { invoiceNumber: rx }, { customerName: rx }];
  }
  return paginate(SaleReturn, filter, q, { populate: { path: 'branchId', select: 'name' } });
}

async function get(req, id) {
  const r = await SaleReturn.findOne({ _id: id, companyId: req.companyId }).populate('branchId').lean();
  if (!r) throw ApiError.notFound('Return not found');
  return r;
}

module.exports = { createReturnInternal, create, list, get };
