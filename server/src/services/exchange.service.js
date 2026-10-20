const { Exchange, Sale, Customer } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, dateRange, escapeRegex, round2 } = require('../utils/common');
const { runInTransaction } = require('../utils/transaction');
const settingsService = require('./settings.service');
const returnService = require('./return.service');
const saleService = require('./sale.service');
const paymentService = require('./payment.service');
const audit = require('./audit.service');

/**
 * Exchange flow (single transaction):
 *  1. return selected items of the original bill (stock +)
 *  2. bill the new items as an exchange sale (stock -), paid first by the returned value
 *  3. difference > 0 -> customer pays (payments), < 0 -> refund or store credit
 */
async function create(req, data) {
  if (!data.newItems?.length) throw ApiError.badRequest('Select the exchange (new) product');
  const result = await runInTransaction(async (session) => {
    const original = await Sale.findOne({ _id: data.saleId, companyId: req.companyId }).session(session).lean();
    if (!original) throw ApiError.notFound('Original bill not found');
    const exchangeNo = await settingsService.nextNumber(req.companyId, 'exchange', { branchId: req.branchId, session });
    const [ex] = await Exchange.create([{
      companyId: req.companyId, branchId: req.branchId, exchangeNo, originalSaleId: original._id, originalInvoice: original.invoiceNumber,
      customerId: original.customerId, customerName: original.customer?.name, reason: data.reason, createdBy: req.user._id, createdByName: req.user.name,
    }], { session });

    const ret = await returnService.createReturnInternal(session, req, { saleId: original._id, items: data.returnItems, reason: data.reason }, { type: 'exchange', exchangeId: ex._id });
    const returnValue = ret.amount;

    // price the new items first so we know the difference
    const settings = await settingsService.get(req.companyId);
    const customer = original.customerId ? await Customer.findById(original.customerId).session(session).lean() : null;
    const branch = await require('../models').Branch.findById(req.branchId).session(session).lean();
    const priced = await saleService.priceCart(req, session, { items: data.newItems, billDiscount: data.billDiscount, customer, branch, settings });
    const newValue = priced.totals.grandTotal;
    const difference = round2(newValue - returnValue);
    const internalCredit = Math.min(returnValue, newValue);

    const sale = await saleService.createSaleInternal(session, req, {
      customerId: original.customerId, items: data.newItems, billDiscount: data.billDiscount,
      payments: difference > 0 ? data.payments : [], notes: `Exchange ${exchangeNo} against ${original.invoiceNumber}`,
    }, { saleType: 'exchange', internalCredit, exchangeId: ex._id });

    let settlement = 'none';
    const payments = sale.payments.filter((p) => p.mode !== 'exchange');
    if (difference > 0) settlement = 'collect';
    else if (difference < 0) {
      const refund = Math.round(-difference);
      const mode = data.refundMode || 'cash';
      if (mode === 'store_credit') {
        if (!original.customerId) throw ApiError.badRequest('Bill has no customer; store credit is not possible. Refund in cash.');
        await Customer.updateOne({ _id: original.customerId }, { $inc: { storeCredit: refund } }, { session });
        settlement = 'store_credit';
      } else if (['cash', 'card', 'upi', 'bank'].includes(mode)) {
        await paymentService.record(session, req, {
          branchId: req.branchId, direction: 'out', type: 'sale_refund', mode, amount: refund,
          partyType: customer ? 'customer' : 'none', partyId: customer?._id, partyName: customer?.name, refType: 'Exchange', refId: ex._id, refNo: exchangeNo,
        });
        settlement = 'refund';
      } else throw ApiError.badRequest('Invalid refund mode');
      payments.push({ mode, amount: -refund });
    }

    Object.assign(ex, {
      returnId: ret._id, returnNo: ret.returnNo, newSaleId: sale._id, newInvoice: sale.invoiceNumber,
      returnValue, newValue, difference, settlement, payments,
    });
    await ex.save({ session });
    return ex;
  });
  await audit.log(req, { action: 'sale.exchange', entity: 'Exchange', entityId: result._id, refNo: result.exchangeNo, branchId: result.branchId, newValue: result.toObject() });
  return get(req, result._id);
}

async function get(req, id) {
  const ex = await Exchange.findOne({ _id: id, companyId: req.companyId }).lean();
  if (!ex) throw ApiError.notFound('Exchange not found');
  const [ret, newInvoice] = await Promise.all([
    returnService.get(req, ex.returnId),
    saleService.invoice(req, ex.newSaleId),
  ]);
  return { ...ex, return: ret, newInvoiceData: newInvoice };
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to) };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ exchangeNo: rx }, { originalInvoice: rx }, { newInvoice: rx }, { customerName: rx }];
  }
  return paginate(Exchange, filter, q, { populate: { path: 'branchId', select: 'name' } });
}

module.exports = { create, get, list };
