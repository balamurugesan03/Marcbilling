// Company, Branch, Role and User management.
const bcrypt = require('bcryptjs');
const { Company, Branch, Role, User, RefreshToken, Permission } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, escapeRegex, pick } = require('../utils/common');
const { PERMISSIONS, ALL_PERMISSIONS } = require('../constants/permissions');
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
async function listBranches(req) {
  const filter = { companyId: req.companyId };
  if (req.query.active) filter.active = req.query.active === 'true';
  // scope=company: every branch's name/code (e.g. stock transfer destinations) without exposing details
  if (req.query.scope === 'company') return Branch.find(filter).select('name code stateCode active').sort({ name: 1 }).lean();
  if (req.allowedBranchIds) filter._id = { $in: req.allowedBranchIds };
  return Branch.find(filter).sort({ name: 1 }).lean();
}

async function createBranch(req, data) {
  const doc = await Branch.create({ ...data, companyId: req.companyId });
  await audit.log(req, { action: 'branch.create', entity: 'Branch', entityId: doc._id, refNo: doc.code, newValue: doc });
  return doc;
}

async function updateBranch(req, id, data) {
  const before = await Branch.findOne({ _id: id, companyId: req.companyId }).lean();
  if (!before) throw ApiError.notFound('Branch not found');
  const doc = await Branch.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true }).lean();
  await audit.log(req, { action: 'branch.update', entity: 'Branch', entityId: id, refNo: doc.code, oldValue: before, newValue: doc });
  return doc;
}

/* ---------- Roles & permissions ---------- */
const listPermissions = async () => {
  const stored = await Permission.find().lean();
  return stored.length ? stored : PERMISSIONS;
};

const listRoles = (req) => Role.find({ companyId: req.companyId }).sort({ system: -1, name: 1 }).lean();

function cleanPerms(perms = []) {
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
  getCompany, updateCompany, listBranches, createBranch, updateBranch,
  listPermissions, listRoles, createRole, updateRole, deleteRole, listUsers, createUser, updateUser,
};
