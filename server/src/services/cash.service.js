const { CashSession, Payment, Expense } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, dateRange, round2 } = require('../utils/common');
const settingsService = require('./settings.service');
const audit = require('./audit.service');

/**
 * Expected closing = opening + cash sales + cash receipts + cash in
 *                    - cash refunds - cash expenses - cash supplier payments - cash out
 */
async function computeSummary(session) {
  const [pay, exp] = await Promise.all([
    Payment.aggregate([
      { $match: { cashSessionId: session._id, mode: 'cash' } },
      { $group: { _id: '$type', amount: { $sum: '$amount' } } },
    ]),
    Expense.aggregate([{ $match: { cashSessionId: session._id, status: 'active', paymentMode: 'cash' } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
  ]);
  const by = Object.fromEntries(pay.map((p) => [p._id, p.amount]));
  const cashIn = session.movements.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount, 0);
  const cashOut = session.movements.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount, 0);
  const s = {
    cashSales: round2(by.sale || 0),
    cashReceipts: round2((by.customer_receipt || 0) + (by.supplier_refund || 0)),
    cashRefunds: round2((by.sale_refund || 0) + (by.sale_cancel || 0)),
    cashExpenses: round2(exp[0]?.amount || 0),
    supplierPayments: round2(by.supplier_payment || 0),
    cashIn: round2(cashIn),
    cashOut: round2(cashOut),
  };
  s.expected = round2(session.openingCash + s.cashSales + s.cashReceipts + s.cashIn - s.cashRefunds - s.cashExpenses - s.supplierPayments - s.cashOut);
  return s;
}

async function current(req) {
  if (!req.branchId) return null;
  const session = await CashSession.findOne({ companyId: req.companyId, branchId: req.branchId, userId: req.user._id, status: 'open' }).lean();
  if (!session) return null;
  return { ...session, summary: await computeSummary(session) };
}

async function open(req, { openingCash, notes }) {
  if (!req.branchId) throw ApiError.badRequest('Select a branch');
  if (await CashSession.exists({ companyId: req.companyId, branchId: req.branchId, userId: req.user._id, status: 'open' })) {
    throw ApiError.badRequest('You already have an open cash session in this branch');
  }
  const sessionNo = await settingsService.nextNumber(req.companyId, 'cashSession', { branchId: req.branchId });
  const doc = await CashSession.create({
    companyId: req.companyId, branchId: req.branchId, sessionNo, userId: req.user._id, userName: req.user.name,
    openingCash: round2(openingCash), closingNotes: notes,
  });
  await audit.log(req, { action: 'cash.open', entity: 'CashSession', entityId: doc._id, refNo: sessionNo, newValue: { openingCash } });
  return doc;
}

async function movement(req, { type, amount, reason }) {
  const s = await CashSession.findOne({ companyId: req.companyId, branchId: req.branchId, userId: req.user._id, status: 'open' });
  if (!s) throw ApiError.badRequest('No open cash session');
  if (type === 'out') {
    const summary = await computeSummary(s);
    if (amount > summary.expected) throw ApiError.badRequest(`Cash out exceeds cash in drawer (₹${summary.expected})`);
  }
  s.movements.push({ type, amount: round2(amount), reason, userId: req.user._id, userName: req.user.name });
  await s.save();
  await audit.log(req, { action: `cash.${type}`, entity: 'CashSession', entityId: s._id, refNo: s.sessionNo, newValue: { amount, reason } });
  return current(req);
}

async function close(req, { actualClosing, denominations, notes }) {
  const s = await CashSession.findOne({ companyId: req.companyId, branchId: req.branchId, userId: req.user._id, status: 'open' });
  if (!s) throw ApiError.badRequest('No open cash session');
  const summary = await computeSummary(s);
  s.summary = summary;
  s.actualClosing = round2(actualClosing);
  s.difference = round2(actualClosing - summary.expected);
  s.denominations = denominations;
  s.closingNotes = notes;
  s.status = 'closed';
  s.closedAt = new Date();
  await s.save();
  await audit.log(req, { action: 'cash.close', entity: 'CashSession', entityId: s._id, refNo: s.sessionNo, newValue: { expected: summary.expected, actual: s.actualClosing, difference: s.difference } });
  return s;
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to, 'openedAt') };
  if (q.userId) filter.userId = q.userId;
  if (q.status) filter.status = q.status;
  if (!req.perms.has('reports.financial') && !req.perms.has('payment.view')) filter.userId = req.user._id;
  const res = await paginate(CashSession, filter, q, { defaultSort: { openedAt: -1 }, populate: { path: 'branchId', select: 'name' } });
  for (const s of res.items) if (s.status === 'open') s.summary = await computeSummary(s);
  return res;
}

module.exports = { current, open, movement, close, list, computeSummary };
