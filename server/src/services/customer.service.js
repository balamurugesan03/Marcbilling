const { Customer, Sale, SaleReturn, Exchange, LoyaltyTransaction, Payment } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, escapeRegex, pick } = require('../utils/common');
const settingsService = require('./settings.service');
const audit = require('./audit.service');

const FIELDS = ['name', 'mobile', 'email', 'address', 'city', 'state', 'stateCode', 'dob', 'anniversary', 'gstNumber', 'notes', 'active'];

function normalise(data) {
  const d = pick(data, FIELDS);
  if (d.mobile) d.mobile = String(d.mobile).replace(/\D/g, '').slice(-10);
  if (d.gstNumber && !d.stateCode) d.stateCode = d.gstNumber.slice(0, 2);
  return d;
}

async function create(req, data) {
  const d = normalise(data);
  if (await Customer.exists({ companyId: req.companyId, mobile: d.mobile })) throw ApiError.conflict(`Customer with mobile ${d.mobile} already exists`);
  const code = await settingsService.nextNumber(req.companyId, 'customer');
  const doc = await Customer.create({ ...d, code, companyId: req.companyId, branchId: req.branchId || undefined });
  await audit.log(req, { action: 'customer.create', entity: 'Customer', entityId: doc._id, refNo: doc.code, newValue: doc });
  return doc;
}

async function update(req, id, data) {
  const before = await Customer.findOne({ _id: id, companyId: req.companyId }).lean();
  if (!before) throw ApiError.notFound('Customer not found');
  const d = normalise(data);
  if (d.mobile && d.mobile !== before.mobile && (await Customer.exists({ companyId: req.companyId, mobile: d.mobile }))) {
    throw ApiError.conflict(`Customer with mobile ${d.mobile} already exists`);
  }
  const doc = await Customer.findByIdAndUpdate(id, { $set: d }, { new: true, runValidators: true }).lean();
  await audit.log(req, { action: 'customer.update', entity: 'Customer', entityId: id, refNo: doc.code, oldValue: before, newValue: doc });
  return doc;
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId };
  if (q.search) {
    const s = String(q.search).trim();
    const digits = s.replace(/\D/g, '');
    const rx = new RegExp(escapeRegex(s), 'i');
    filter.$or = [{ name: rx }, { code: s.toUpperCase() }, { email: rx }];
    if (digits.length >= 3) filter.$or.push({ mobile: { $regex: `^${digits}` } }, { mobile: { $regex: `${digits}$` } });
  }
  if (q.outstanding === 'true') filter.outstanding = { $gt: 0 };
  if (q.storeCredit === 'true') filter.storeCredit = { $gt: 0 };
  if (q.active) filter.active = q.active === 'true';
  return paginate(Customer, filter, q, { defaultSort: { updatedAt: -1 } });
}

/** Quick lookup for POS (by mobile prefix / name). */
async function search(req) {
  const s = String(req.query.q || '').trim();
  if (!s) return [];
  const digits = s.replace(/\D/g, '');
  const filter = { companyId: req.companyId, active: true };
  filter.$or = digits.length >= 3 && digits.length === s.replace(/\s/g, '').length
    ? [{ mobile: { $regex: `^${digits}` } }, { mobile: digits.slice(-10) }]
    : [{ name: new RegExp(escapeRegex(s), 'i') }, { code: s.toUpperCase() }];
  return Customer.find(filter).sort({ lastPurchaseAt: -1 }).limit(15).lean();
}

async function profile(req, id) {
  const customer = await Customer.findOne({ _id: id, companyId: req.companyId }).lean();
  if (!customer) throw ApiError.notFound('Customer not found');
  const scope = { companyId: req.companyId, customerId: customer._id };
  const [sales, returns, exchanges, loyalty, receipts, stats] = await Promise.all([
    Sale.find(scope).sort({ createdAt: -1 }).limit(50).populate('branchId', 'name').select('invoiceNumber createdAt totals.grandTotal itemCount status returnStatus creditAmount payments branchId saleType').lean(),
    SaleReturn.find(scope).sort({ createdAt: -1 }).limit(50).lean(),
    Exchange.find(scope).sort({ createdAt: -1 }).limit(50).lean(),
    LoyaltyTransaction.find(scope).sort({ createdAt: -1 }).limit(50).lean(),
    Payment.find({ companyId: req.companyId, partyId: customer._id, type: 'customer_receipt' }).sort({ date: -1 }).limit(50).lean(),
    Sale.aggregate([{ $match: { ...scope, status: 'completed' } }, { $group: { _id: null, total: { $sum: '$totals.grandTotal' }, bills: { $sum: 1 }, avg: { $avg: '$totals.grandTotal' } } }]),
  ]);
  return { customer, sales, returns, exchanges, loyalty, receipts, stats: stats[0] || { total: 0, bills: 0, avg: 0 } };
}

module.exports = { create, update, list, search, profile };
