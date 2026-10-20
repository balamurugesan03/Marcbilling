const { Payment, Customer, Supplier, Purchase, CashSession, Sale } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, dateRange, escapeRegex, round2 } = require('../utils/common');
const { runInTransaction } = require('../utils/transaction');
const settingsService = require('./settings.service');
const audit = require('./audit.service');

/** Open cash session of the current user in the given branch (cash movements are tagged with it). */
async function openSessionId(req, branchId, session = null) {
  const s = await CashSession.findOne({ companyId: req.companyId, branchId, userId: req.user._id, status: 'open' }).select('_id').session(session).lean();
  return s?._id;
}

/** Creates a Payment row inside a transaction. */
async function record(session, req, { branchId, direction, type, mode, amount, reference, partyType, partyId, partyName, refType, refId, refNo, notes, date }) {
  if (!(amount > 0)) return null;
  const paymentNo = await settingsService.nextNumber(req.companyId, 'payment', { branchId, session });
  const cashSessionId = mode === 'cash' ? await openSessionId(req, branchId, session) : undefined;
  const [p] = await Payment.create([{
    companyId: req.companyId, branchId, paymentNo, direction, type, mode, amount: round2(amount), reference,
    partyType: partyType || 'none', partyId, partyName, refType, refId, refNo, notes, date: date || new Date(),
    userId: req.user._id, userName: req.user.name, cashSessionId,
  }], { session });
  return p;
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to, 'date') };
  if (q.type) filter.type = q.type;
  if (q.mode) filter.mode = q.mode;
  if (q.direction) filter.direction = q.direction;
  if (q.partyId) filter.partyId = q.partyId;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ paymentNo: rx }, { refNo: rx }, { partyName: rx }, { reference: rx }];
  }
  return paginate(Payment, filter, q, { defaultSort: { date: -1 }, populate: { path: 'branchId', select: 'name' } });
}

/** Collect customer outstanding (credit sales). Allocates FIFO over credit invoices. */
async function customerReceipt(req, { customerId, amount, mode, reference, notes }) {
  if (!req.branchId) throw ApiError.badRequest('Select a branch');
  if (['credit', 'store_credit', 'loyalty', 'exchange'].includes(mode)) throw ApiError.badRequest('Invalid receipt mode');
  const result = await runInTransaction(async (session) => {
    const customer = await Customer.findOne({ _id: customerId, companyId: req.companyId }).session(session);
    if (!customer) throw ApiError.notFound('Customer not found');
    if (amount > round2(customer.outstanding) + 0.001) throw ApiError.badRequest(`Amount exceeds outstanding (₹${round2(customer.outstanding)})`);
    customer.outstanding = round2(customer.outstanding - amount);
    await customer.save({ session });
    // reduce creditAmount on oldest credit invoices
    let left = amount;
    const sales = await Sale.find({ companyId: req.companyId, customerId, creditAmount: { $gt: 0 }, status: 'completed' }).sort({ createdAt: 1 }).session(session);
    for (const s of sales) {
      if (left <= 0) break;
      const take = Math.min(left, s.creditAmount);
      s.creditAmount = round2(s.creditAmount - take);
      s.paidAmount = round2(s.paidAmount + take);
      left = round2(left - take);
      await s.save({ session });
    }
    return record(session, req, {
      branchId: req.branchId, direction: 'in', type: 'customer_receipt', mode, amount, reference, notes,
      partyType: 'customer', partyId: customer._id, partyName: customer.name, refType: 'Customer', refId: customer._id, refNo: customer.code,
    });
  });
  await audit.log(req, { action: 'payment.customer_receipt', entity: 'Payment', entityId: result._id, refNo: result.paymentNo, newValue: result });
  return result;
}

/** Pay supplier. With purchaseId it is allocated to that invoice, else FIFO over unpaid purchases. */
async function supplierPayment(req, { supplierId, purchaseId, amount, mode, reference, notes }, session0 = null) {
  if (!req.branchId) throw ApiError.badRequest('Select a branch');
  if (!['cash', 'card', 'upi', 'bank'].includes(mode)) throw ApiError.badRequest('Invalid payment mode for supplier payment');
  const work = async (session) => {
    const supplier = await Supplier.findOne({ _id: supplierId, companyId: req.companyId }).session(session);
    if (!supplier) throw ApiError.notFound('Supplier not found');
    const filter = { companyId: req.companyId, supplierId, status: 'received', dueAmount: { $gt: 0 } };
    if (purchaseId) filter._id = purchaseId;
    const purchases = await Purchase.find(filter).sort({ invoiceDate: 1 }).session(session);
    if (purchaseId && !purchases.length) throw ApiError.badRequest('Purchase is fully paid or not received');
    const totalDue = round2(purchases.reduce((a, p) => a + p.dueAmount, 0));
    if (purchaseId && amount > totalDue + 0.001) throw ApiError.badRequest(`Amount exceeds purchase due (₹${totalDue})`);
    let left = amount;
    for (const p of purchases) {
      if (left <= 0) break;
      const take = Math.min(left, p.dueAmount);
      p.paidAmount = round2(p.paidAmount + take);
      p.dueAmount = round2(p.dueAmount - take);
      p.paymentStatus = p.dueAmount <= 0 ? 'paid' : 'partial';
      left = round2(left - take);
      await p.save({ session });
    }
    supplier.balance = round2(supplier.balance - amount);
    await supplier.save({ session });
    return record(session, req, {
      branchId: req.branchId, direction: 'out', type: 'supplier_payment', mode, amount, reference, notes,
      partyType: 'supplier', partyId: supplier._id, partyName: supplier.name,
      refType: purchaseId ? 'Purchase' : 'Supplier', refId: purchaseId || supplier._id, refNo: purchases[0]?.purchaseNo || supplier.name,
    });
  };
  const result = session0 !== null ? await work(session0) : await runInTransaction(work);
  if (session0 === null) await audit.log(req, { action: 'payment.supplier', entity: 'Payment', entityId: result._id, refNo: result.paymentNo, newValue: result });
  return result;
}

/** Payment-mode summary for a period. */
async function summary(req) {
  const q = req.query;
  const match = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to, 'date') };
  return Payment.aggregate([
    { $match: match },
    { $group: { _id: { mode: '$mode', direction: '$direction', type: '$type' }, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { '_id.mode': 1 } },
  ]);
}

module.exports = { record, list, customerReceipt, supplierPayment, summary, openSessionId };
