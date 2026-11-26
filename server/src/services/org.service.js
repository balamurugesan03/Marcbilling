// Company, Branch, Role and User management.
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const {
  Company, Branch, Role, User, RefreshToken, Permission, Customer, Stock, HeldBill, Counter, Supplier,
  Product, ProductVariant, Barcode, LoyaltyTransaction, SaleItem, PurchaseItem, StockTransferItem,
  Sale, SaleReturn, Exchange, Purchase, PurchaseReturn, StockLedger, StockAdjustment, StockTransfer, Expense, Payment, CashSession,
} = require('../models');
const backup = require('./backup.service');
const ApiError = require('../utils/ApiError');
const { paginate, escapeRegex, pick } = require('../utils/common');
const { PERMISSIONS, ALL_PERMISSIONS, LEGACY_PERMISSIONS } = require('../constants/permissions');
const audit = require('./audit.service');

/* ---------- Company ---------- */
const getCompany = (req) => Company.findById(req.companyId).lean();

async function updateCompany(req, data) {
  const before = await Company.findById(req.companyId).lean();
  const doc = await Company.findByIdAndUpdate(req.companyId, { $set: pick(data, ['name', 'legalName', 'gstin', 'pan', 'email', 'phone', 'website', 'address', 'logoUrl']) }, { new: true, runValidators: true }).lean();
  await audit.log(req, { action: 'company.update', entity: 'Company', entityId: doc._id, oldValue: before, newValue: doc });
  return doc;
}

/* ---------- Branch ---------- */
/** Branches made before main / sub existed: the default (or oldest) one becomes the main, the rest sub branches under it. */
async function ensureMainBranch(companyId) {
  if (await Branch.exists({ companyId, type: 'main' })) return;
  const main = await Branch.findOne({ companyId }).sort({ isDefault: -1, createdAt: 1 }).lean();
  if (main) await makeMain(companyId, main._id);
}

/** Only one main branch: making a branch the main moves every other branch under it as a sub branch. */
async function makeMain(companyId, id) {
  await Branch.updateMany({ companyId, _id: { $ne: id } }, { $set: { type: 'sub', parentId: id } });
  await Branch.updateOne({ _id: id }, { $set: { type: 'main', parentId: null } });
}

async function listBranches(req) {
  await ensureMainBranch(req.companyId);
  const filter = { companyId: req.companyId };
  if (req.query.active) filter.active = req.query.active === 'true';
  // scope=company: every branch's name/code (e.g. stock transfer destinations) without exposing details
  if (req.query.scope === 'company') return Branch.find(filter).select('name code type stateCode active').sort({ type: 1, name: 1 }).lean();
  if (req.allowedBranchIds) filter._id = { $in: req.allowedBranchIds };
  return Branch.find(filter).sort({ type: 1, name: 1 }).lean(); // main first ('main' < 'sub')
}

async function createBranch(req, data) {
  await ensureMainBranch(req.companyId);
  const main = await Branch.findOne({ companyId: req.companyId, type: 'main' }).lean();
  const isMain = !main || data.type === 'main'; // the first branch is always the main
  const doc = await Branch.create({ ...data, type: isMain ? 'main' : 'sub', parentId: isMain ? null : main._id, companyId: req.companyId });
  if (isMain && main) await makeMain(req.companyId, doc._id);
  await audit.log(req, { action: 'branch.create', entity: 'Branch', entityId: doc._id, refNo: doc.code, newValue: doc });
  return Branch.findById(doc._id).lean();
}

async function updateBranch(req, id, data) {
  await ensureMainBranch(req.companyId);
  const before = await Branch.findOne({ _id: id, companyId: req.companyId }).lean();
  if (!before) throw ApiError.notFound('Branch not found');
  const { type, ...rest } = data;
  if (type === 'sub' && before.type === 'main') throw ApiError.badRequest('There must be one main branch. Open another branch and set it as Main branch instead');
  if ((type === 'main' || before.type === 'main') && rest.active === false) throw ApiError.badRequest('The main branch cannot be made inactive');
  await Branch.updateOne({ _id: id }, { $set: rest }, { runValidators: true });
  if (type === 'main' && before.type !== 'main') await makeMain(req.companyId, before._id);
  const doc = await Branch.findById(id).lean();
  await audit.log(req, { action: 'branch.update', entity: 'Branch', entityId: id, refNo: doc.code, oldValue: before, newValue: doc });
  return doc;
}

/** Customer bill totals recomputed from the bills that are left (after bills were deleted). */
async function recomputeCustomers(companyIdIn, customerIds) {
  const companyId = new mongoose.Types.ObjectId(String(companyIdIn));
  for (const cid of customerIds) {
    const [s] = await Sale.aggregate([
      { $match: { companyId, customerId: cid, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$totals.grandTotal' }, bills: { $sum: 1 }, last: { $max: '$invoiceDate' } } },
    ]);
    const [r] = await SaleReturn.aggregate([{ $match: { companyId, customerId: cid } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    await Customer.updateOne({ _id: cid }, { $set: { totalPurchases: s?.total || 0, totalBills: s?.bills || 0, lastPurchaseAt: s?.last || null, totalReturns: r?.total || 0 } });
  }
}

/**
 * Deletes a branch together with everything recorded in it: bills, returns, exchanges, purchases, stock,
 * transfers, expenses, payments and cash sessions. A safety backup is taken first.
 * Deleting the main branch makes the oldest remaining branch the main.
 */
async function deleteBranch(req, id) {
  await ensureMainBranch(req.companyId);
  const branch = await Branch.findOne({ _id: id, companyId: req.companyId }).lean();
  if (!branch) throw ApiError.notFound('Branch not found');
  if (req.allowedBranchIds && !req.allowedBranchIds.includes(String(id))) throw ApiError.forbidden('You do not have access to this branch');
  if (!(await Branch.exists({ companyId: req.companyId, _id: { $ne: id } }))) {
    throw ApiError.badRequest('This is the only branch, so it cannot be deleted. Use Clear all data (Backup page) to start fresh instead');
  }
  const safety = await backup.create(req, { type: 'pre_delete', notes: `Automatic backup before deleting branch ${branch.name}` });

  const b = branch._id;
  const sales = await Sale.find({ branchId: b }).select('_id customerId').lean();
  const purchases = await Purchase.find({ branchId: b }).select('_id').lean();
  const transfers = await StockTransfer.find({ $or: [{ fromBranchId: b }, { toBranchId: b }] }).select('_id').lean();
  const affectedUsers = (await User.find({ companyId: req.companyId, $or: [{ branchIds: b }, { defaultBranchId: b }] }).select('_id').lean()).map((u) => u._id);
  const customerIds = [...new Set(sales.map((s) => s.customerId && String(s.customerId)).filter(Boolean))].map((x) => new mongoose.Types.ObjectId(x));
  await Promise.all([
    SaleItem.deleteMany({ $or: [{ branchId: b }, { saleId: { $in: sales.map((s) => s._id) } }] }),
    Sale.deleteMany({ branchId: b }), SaleReturn.deleteMany({ branchId: b }), Exchange.deleteMany({ branchId: b }),
    PurchaseItem.deleteMany({ $or: [{ branchId: b }, { purchaseId: { $in: purchases.map((p) => p._id) } }] }),
    Purchase.deleteMany({ branchId: b }), PurchaseReturn.deleteMany({ branchId: b }),
    StockTransferItem.deleteMany({ transferId: { $in: transfers.map((t) => t._id) } }),
    StockTransfer.deleteMany({ _id: { $in: transfers.map((t) => t._id) } }),
    StockLedger.deleteMany({ branchId: b }), StockAdjustment.deleteMany({ branchId: b }), Stock.deleteMany({ branchId: b }),
    Expense.deleteMany({ branchId: b }), Payment.deleteMany({ branchId: b }), CashSession.deleteMany({ branchId: b }),
    HeldBill.deleteMany({ branchId: b }), LoyaltyTransaction.deleteMany({ branchId: b }),
    Customer.updateMany({ companyId: req.companyId, branchId: b }, { $unset: { branchId: 1 } }),
    User.updateMany({ companyId: req.companyId, branchIds: b }, { $pull: { branchIds: b } }),
  ]);
  await User.updateMany({ companyId: req.companyId, defaultBranchId: b }, { $unset: { defaultBranchId: 1 } });
  await Branch.deleteOne({ _id: b });
  if (branch.type === 'main') {
    const next = await Branch.findOne({ companyId: req.companyId }).sort({ active: -1, createdAt: 1 }).lean();
    if (next) await makeMain(req.companyId, next._id);
  }
  // users left with no branch get the main branch
  const main = await Branch.findOne({ companyId: req.companyId, type: 'main' }).lean();
  if (main && affectedUsers.length) {
    await User.updateMany({ _id: { $in: affectedUsers }, branchIds: { $size: 0 } }, { $set: { branchIds: [main._id] } });
    await User.updateMany({ _id: { $in: affectedUsers }, defaultBranchId: { $exists: false } }, [{ $set: { defaultBranchId: { $ifNull: [{ $first: '$branchIds' }, main._id] } } }]);
  }
  await recomputeCustomers(req.companyId, customerIds);
  await audit.log(req, { action: 'branch.delete', entity: 'Branch', entityId: id, refNo: branch.code, oldValue: branch, newValue: { bills: sales.length, purchases: purchases.length, safetyBackup: safety.fileName } });
  return { bills: sales.length, purchases: purchases.length, safetyBackup: safety.fileName };
}

/**
 * Clears the company's data for a fresh start. Always: every bill, return, exchange, purchase, stock entry,
 * transfer, adjustment, expense, payment, cash session, held bill, loyalty entry and number series.
 * Optional: products (with variants, barcodes), customers, suppliers. Company, branches, users, roles,
 * settings, categories and brands are kept. A safety backup is taken first.
 */
async function clearData(req, { products = false, customers = false, suppliers = false } = {}) {
  const companyId = new mongoose.Types.ObjectId(String(req.companyId));
  const safety = await backup.create(req, { type: 'pre_delete', notes: 'Automatic backup before Clear all data' });
  const c = { companyId };
  const counts = {};
  const wipe = async (name, M) => { counts[name] = (await M.deleteMany(c)).deletedCount; };
  await Promise.all([
    wipe('bills', Sale), wipe('billItems', SaleItem), wipe('salesReturns', SaleReturn), wipe('exchanges', Exchange),
    wipe('purchases', Purchase), wipe('purchaseItems', PurchaseItem), wipe('purchaseReturns', PurchaseReturn),
    wipe('transfers', StockTransfer), wipe('transferItems', StockTransferItem), wipe('stockLedger', StockLedger),
    wipe('adjustments', StockAdjustment), wipe('stock', Stock), wipe('expenses', Expense), wipe('payments', Payment),
    wipe('cashSessions', CashSession), wipe('heldBills', HeldBill), wipe('loyalty', LoyaltyTransaction),
  ]);
  // number series start again from 1 (invoice, purchase, transfer… and barcodes when products go)
  const keyRx = new RegExp(`^${companyId}:`);
  const counterFilter = products ? { key: keyRx } : { key: keyRx, $nor: [{ key: new RegExp(`^${companyId}:barcode:`) }] };
  counts.numberSeries = (await Counter.deleteMany(counterFilter)).deletedCount;
  if (products) await Promise.all([wipe('products', Product), wipe('variants', ProductVariant), wipe('barcodes', Barcode)]);
  if (customers) await wipe('customers', Customer);
  else await Customer.updateMany(c, { $set: { loyaltyPoints: 0, outstanding: 0, storeCredit: 0, totalPurchases: 0, totalBills: 0, totalReturns: 0, lastPurchaseAt: null } });
  if (suppliers) await wipe('suppliers', Supplier);
  else await Supplier.updateMany(c, [{ $set: { balance: { $ifNull: ['$openingBalance', 0] } } }]);
  await audit.log(req, { action: 'data.clear', entity: 'Company', entityId: companyId, newValue: { products, customers, suppliers, counts, safetyBackup: safety.fileName } });
  return { counts, safetyBackup: safety.fileName };
}

/* ---------- Roles & permissions ---------- */
const listPermissions = async () => {
  const stored = await Permission.find().lean();
  return stored.length ? stored : PERMISSIONS;
};

const listRoles = async (req) => (await Role.find({ companyId: req.companyId }).sort({ system: -1, name: 1 }).lean())
  .map((r) => ({ ...r, permissions: r.code === 'super_admin' ? ALL_PERMISSIONS : cleanPerms(r.permissions, { strict: false }) }));

/** Old "manage" keys are expanded to the module-wise keys; unknown keys are rejected (or dropped when strict is false). */
function cleanPerms(input = [], { strict = true } = {}) {
  const perms = input.flatMap((k) => LEGACY_PERMISSIONS[k] || [k]);
  if (!strict) return [...new Set(perms.filter((p) => ALL_PERMISSIONS.includes(p)))];
  const bad = perms.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (bad.length) throw ApiError.badRequest(`Unknown permissions: ${bad.join(', ')}`);
  return [...new Set(perms)];
}

async function createRole(req, data) {
  const code = (data.code || data.name).toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const doc = await Role.create({ ...data, code, permissions: cleanPerms(data.permissions), companyId: req.companyId, system: false });
  await audit.log(req, { action: 'role.create', entity: 'Role', entityId: doc._id, refNo: doc.name, newValue: doc });
  return doc;
}

async function updateRole(req, id, data) {
  const role = await Role.findOne({ _id: id, companyId: req.companyId });
  if (!role) throw ApiError.notFound('Role not found');
  if (role.code === 'super_admin') throw ApiError.badRequest('The Super Admin role cannot be modified');
  const before = role.toObject();
  Object.assign(role, pick(data, ['name', 'description', 'allBranches', 'maxDiscountPercent']));
  if (data.permissions) role.permissions = cleanPerms(data.permissions);
  await role.save();
  await audit.log(req, { action: 'role.update', entity: 'Role', entityId: role._id, refNo: role.name, oldValue: before, newValue: role.toObject() });
  return role;
}

async function deleteRole(req, id) {
  const role = await Role.findOne({ _id: id, companyId: req.companyId });
  if (!role) throw ApiError.notFound('Role not found');
  if (role.system) throw ApiError.badRequest('System roles cannot be deleted');
  if (await User.exists({ roleId: id })) throw ApiError.badRequest('Role is assigned to users; reassign them first');
  await role.deleteOne();
  await audit.log(req, { action: 'role.delete', entity: 'Role', entityId: id, refNo: role.name, oldValue: role.toObject() });
}

/* ---------- Users ---------- */
async function listUsers(req) {
  const q = req.query;
  const filter = { companyId: req.companyId };
  if (req.allowedBranchIds) filter.branchIds = { $in: req.allowedBranchIds };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { username: rx }, { mobile: rx }];
  }
  if (q.roleId) filter.roleId = q.roleId;
  return paginate(User, filter, q, { populate: [{ path: 'roleId', select: 'name code' }, { path: 'branchIds', select: 'name code' }], defaultSort: { name: 1 } });
}

async function validateUserRefs(req, data) {
  if (data.roleId) {
    const role = await Role.findOne({ _id: data.roleId, companyId: req.companyId }).lean();
    if (!role) throw ApiError.badRequest('Invalid role');
    if (role.code === 'super_admin' && !req.isSuperAdmin) throw ApiError.forbidden('Only a Super Admin can assign the Super Admin role');
  }
  if (data.branchIds) {
    const count = await Branch.countDocuments({ companyId: req.companyId, _id: { $in: data.branchIds } });
    if (count !== data.branchIds.length) throw ApiError.badRequest('Invalid branch selection');
    if (req.allowedBranchIds && data.branchIds.some((b) => !req.allowedBranchIds.includes(String(b)))) {
      throw ApiError.forbidden('You can only assign branches you manage');
    }
  }
  if (data.defaultBranchId && data.branchIds && !data.branchIds.map(String).includes(String(data.defaultBranchId))) {
    data.defaultBranchId = data.branchIds[0];
  }
}

async function createUser(req, data) {
  await validateUserRefs(req, data);
  const { password, ...rest } = data;
  const doc = await User.create({ ...rest, companyId: req.companyId, passwordHash: await bcrypt.hash(password, 10), defaultBranchId: rest.defaultBranchId || rest.branchIds?.[0] });
  const out = doc.toObject();
  delete out.passwordHash;
  await audit.log(req, { action: 'user.create', entity: 'User', entityId: doc._id, refNo: doc.username, newValue: out });
  return out;
}

async function updateUser(req, id, data) {
  const user = await User.findOne({ _id: id, companyId: req.companyId });
  if (!user) throw ApiError.notFound('User not found');
  const targetRole = await Role.findById(user.roleId).lean();
  if (targetRole?.code === 'super_admin' && !req.isSuperAdmin) throw ApiError.forbidden('Only a Super Admin can modify a Super Admin');
  if (String(user._id) === String(req.user._id) && data.active === false) throw ApiError.badRequest('You cannot disable your own account');
  await validateUserRefs(req, { ...data, branchIds: data.branchIds || undefined });
  const before = user.toObject();
  delete before.passwordHash;
  Object.assign(user, pick(data, ['name', 'email', 'mobile', 'roleId', 'branchIds', 'defaultBranchId', 'active']));
  const securityChange = data.password || data.active === false || (data.roleId && String(data.roleId) !== String(before.roleId));
  if (data.password) user.passwordHash = await bcrypt.hash(data.password, 10);
  if (securityChange) {
    user.tokenVersion += 1;
    await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  }
  await user.save();
  const after = user.toObject();
  delete after.passwordHash;
  await audit.log(req, { action: data.password ? 'user.password_reset' : 'user.update', entity: 'User', entityId: user._id, refNo: user.username, oldValue: before, newValue: after });
  return after;
}

module.exports = {
  getCompany, updateCompany, listBranches, createBranch, updateBranch, deleteBranch, clearData,
  listPermissions, listRoles, createRole, updateRole, deleteRole, listUsers, createUser, updateUser,
};
