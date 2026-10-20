const { LoyaltyTransaction, Customer } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, dateRange } = require('../utils/common');
const { runInTransaction } = require('../utils/transaction');
const audit = require('./audit.service');

/** Adds (or deducts with negative points) loyalty points on a loaded customer document. */
async function add(session, req, customer, points, { type, refType, refId, refNo, branchId, note, clamp = false }) {
  let delta = Math.trunc(points);
  if (clamp && customer.loyaltyPoints + delta < 0) delta = -customer.loyaltyPoints;
  if (!delta) return null;
  if (customer.loyaltyPoints + delta < 0) throw ApiError.badRequest('Insufficient loyalty points');
  customer.loyaltyPoints += delta;
  await customer.save({ session });
  const [t] = await LoyaltyTransaction.create([{
    companyId: req.companyId, customerId: customer._id, branchId: branchId || req.branchId, type, points: delta,
    balanceAfter: customer.loyaltyPoints, refType, refId, refNo, note, userId: req.user._id,
  }], { session });
  return t;
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...dateRange(q.from, q.to) };
  if (q.customerId) filter.customerId = q.customerId;
  if (q.type) filter.type = q.type;
  return paginate(LoyaltyTransaction, filter, q, { populate: [{ path: 'customerId', select: 'name mobile code' }, { path: 'branchId', select: 'name' }] });
}

async function adjust(req, { customerId, points, note }) {
  const t = await runInTransaction(async (session) => {
    const customer = await Customer.findOne({ _id: customerId, companyId: req.companyId }).session(session);
    if (!customer) throw ApiError.notFound('Customer not found');
    return add(session, req, customer, points, { type: 'adjust', refType: 'Manual', note });
  });
  await audit.log(req, { action: 'loyalty.adjust', entity: 'Customer', entityId: customerId, newValue: { points, note } });
  return t;
}

module.exports = { add, list, adjust };
