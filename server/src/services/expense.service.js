const { Expense, ExpenseCategory } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, dateRange, escapeRegex, round2 } = require('../utils/common');
const settingsService = require('./settings.service');
const paymentService = require('./payment.service');
const audit = require('./audit.service');

async function create(req, data) {
  const branchId = data.branchId || req.branchId;
  if (!branchId) throw ApiError.badRequest('Select a branch');
  if (req.allowedBranchIds && !req.allowedBranchIds.includes(String(branchId))) throw ApiError.forbidden();
  const cat = await ExpenseCategory.findOne({ _id: data.categoryId, companyId: req.companyId }).lean();
  if (!cat) throw ApiError.badRequest('Expense category not found');
  const expenseNo = await settingsService.nextNumber(req.companyId, 'expense', { branchId });
  const cashSessionId = data.paymentMode === 'cash' ? await paymentService.openSessionId(req, branchId) : undefined;
  const doc = await Expense.create({
    ...data, companyId: req.companyId, branchId, expenseNo, categoryName: cat.name, amount: round2(data.amount),
    userId: req.user._id, userName: req.user.name, cashSessionId,
  });
  await audit.log(req, { action: 'expense.create', entity: 'Expense', entityId: doc._id, refNo: expenseNo, branchId, newValue: doc });
  return doc;
}

async function update(req, id, data) {
  const before = await Expense.findOne({ _id: id, companyId: req.companyId, ...req.branchScope }).lean();
  if (!before) throw ApiError.notFound('Expense not found');
  if (before.status === 'cancelled') throw ApiError.badRequest('Cancelled expenses cannot be edited');
  if (data.categoryId) {
    const cat = await ExpenseCategory.findOne({ _id: data.categoryId, companyId: req.companyId }).lean();
    if (!cat) throw ApiError.badRequest('Expense category not found');
    data.categoryName = cat.name;
  }
  delete data.branchId;
  const doc = await Expense.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true }).lean();
  await audit.log(req, { action: 'expense.update', entity: 'Expense', entityId: id, refNo: doc.expenseNo, oldValue: before, newValue: doc });
  return doc;
}

async function cancel(req, id) {
  const doc = await Expense.findOneAndUpdate({ _id: id, companyId: req.companyId, ...req.branchScope, status: 'active' }, { $set: { status: 'cancelled' } }, { new: true }).lean();
  if (!doc) throw ApiError.notFound('Expense not found');
  await audit.log(req, { action: 'expense.cancel', entity: 'Expense', entityId: id, refNo: doc.expenseNo, oldValue: { status: 'active' }, newValue: { status: 'cancelled' } });
  return doc;
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to, 'date') };
  if (q.categoryId) filter.categoryId = q.categoryId;
  if (q.paymentMode) filter.paymentMode = q.paymentMode;
  if (q.status) filter.status = q.status;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ expenseNo: rx }, { paidTo: rx }, { notes: rx }, { categoryName: rx }];
  }
  const res = await paginate(Expense, filter, q, { defaultSort: { date: -1 }, populate: { path: 'branchId', select: 'name' } });
  const [agg] = await Expense.aggregate([{ $match: { ...filter, status: 'active' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
  res.summary = { total: agg?.total || 0 };
  return res;
}

module.exports = { create, update, cancel, list };
