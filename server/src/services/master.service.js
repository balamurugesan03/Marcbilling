// Simple master data: categories, brands, suppliers, expense categories.
const { Category, Brand, Supplier, ExpenseCategory, Product, Expense, Purchase } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, escapeRegex } = require('../utils/common');
const audit = require('./audit.service');

const MASTERS = {
  category: { Model: Category, label: 'Category', inUse: (id) => Product.exists({ $or: [{ categoryId: id }, { subCategoryId: id }] }) },
  brand: { Model: Brand, label: 'Brand', inUse: (id) => Product.exists({ brandId: id }) },
  supplier: { Model: Supplier, label: 'Supplier', inUse: (id) => Purchase.exists({ supplierId: id }) },
  expenseCategory: { Model: ExpenseCategory, label: 'Expense category', inUse: (id) => Expense.exists({ categoryId: id }) },
};

function cfg(kind) {
  const c = MASTERS[kind];
  if (!c) throw ApiError.notFound();
  return c;
}

async function list(req, kind) {
  const { Model } = cfg(kind);
  const q = req.query;
  const filter = { companyId: req.companyId };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { code: rx }, { mobile: rx }];
  }
  if (q.active) filter.active = q.active === 'true';
  if (kind === 'category') {
    if (q.parentId === 'root') filter.parentId = null;
    else if (q.parentId) filter.parentId = q.parentId;
  }
  if (q.all === 'true') {
    const items = await Model.find(filter).sort({ name: 1 }).limit(2000).lean();
    return { items, total: items.length, page: 1, pages: 1 };
  }
  return paginate(Model, filter, q, { defaultSort: { name: 1 }, populate: kind === 'category' ? { path: 'parentId', select: 'name' } : undefined });
}

async function get(req, kind, id) {
  const { Model, label } = cfg(kind);
  const doc = await Model.findOne({ _id: id, companyId: req.companyId }).lean();
  if (!doc) throw ApiError.notFound(`${label} not found`);
  return doc;
}

async function create(req, kind, data) {
  const { Model } = cfg(kind);
  if (kind === 'category' && data.parentId) {
    const parent = await Category.findOne({ _id: data.parentId, companyId: req.companyId });
    if (!parent) throw ApiError.badRequest('Parent category not found');
    if (parent.parentId) throw ApiError.badRequest('Sub-categories can only be one level deep');
  }
  if (kind === 'supplier') data.balance = data.openingBalance || 0;
  const doc = await Model.create({ ...data, companyId: req.companyId });
  await audit.log(req, { action: `${kind}.create`, entity: Model.modelName, entityId: doc._id, refNo: doc.name, newValue: doc });
  return doc;
}

async function update(req, kind, id, data) {
  const { Model, label } = cfg(kind);
  const before = await Model.findOne({ _id: id, companyId: req.companyId }).lean();
  if (!before) throw ApiError.notFound(`${label} not found`);
  if (kind === 'supplier') delete data.balance;
  if (kind === 'category' && data.parentId && String(data.parentId) === String(id)) throw ApiError.badRequest('A category cannot be its own parent');
  const doc = await Model.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true }).lean();
  await audit.log(req, { action: `${kind}.update`, entity: Model.modelName, entityId: id, refNo: doc.name, oldValue: before, newValue: doc });
  if (kind === 'category' || kind === 'brand') {
    // keep denormalised names on variants in sync
    const { ProductVariant } = require('../models');
    if (before.name !== doc.name) {
      const field = kind === 'category' ? { categoryId: id } : { brandId: id };
      const set = kind === 'category' ? { categoryName: doc.name } : { brandName: doc.name };
      await ProductVariant.updateMany({ companyId: req.companyId, ...field }, { $set: set });
    }
  }
  return doc;
}

async function remove(req, kind, id) {
  const { Model, label, inUse } = cfg(kind);
  const doc = await Model.findOne({ _id: id, companyId: req.companyId });
  if (!doc) throw ApiError.notFound(`${label} not found`);
  if (await inUse(id)) throw ApiError.badRequest(`${label} is in use and cannot be deleted. Mark it inactive instead.`);
  if (kind === 'category' && (await Category.exists({ parentId: id }))) throw ApiError.badRequest('Delete its sub-categories first');
  await doc.deleteOne();
  await audit.log(req, { action: `${kind}.delete`, entity: Model.modelName, entityId: id, refNo: doc.name, oldValue: doc.toObject() });
}

module.exports = { list, get, create, update, remove };
