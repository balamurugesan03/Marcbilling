const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { User, RefreshToken, Branch, Company } = require('../models');
const audit = require('./audit.service');
const { normalizePermissions, ALL_PERMISSIONS } = require('../constants/permissions');

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function signAccess(user) {
  return jwt.sign({ sub: String(user._id), tv: user.tokenVersion, cid: String(user.companyId) }, env.jwtAccessSecret, { expiresIn: env.accessTokenTtl });
}

async function issueRefresh(user, req) {
  const token = crypto.randomBytes(48).toString('hex');
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + env.refreshTokenDays * 86400000),
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  return token;
}

async function profile(userId) {
  const user = await User.findById(userId).populate('roleId').lean();
  const role = user.roleId;
  const branchFilter = { companyId: user.companyId, active: true };
  if (!role.allBranches) branchFilter._id = { $in: user.branchIds };
  const [branches, company] = await Promise.all([
    Branch.find(branchFilter).sort({ type: 1, name: 1 }).lean(),
    Company.findById(user.companyId).lean(),
  ]);
  return {
    user: {
      _id: user._id, name: user.name, username: user.username, email: user.email, mobile: user.mobile,
      branchIds: user.branchIds, defaultBranchId: user.defaultBranchId || branches[0]?._id,
      role: { _id: role._id, name: role.name, code: role.code, allBranches: role.allBranches, maxDiscountPercent: role.maxDiscountPercent, permissions: role.code === 'super_admin' ? ALL_PERMISSIONS : normalizePermissions(role.permissions) },
    },
    branches,
    company,
  };
}

async function login(req, { username, password }) {
  const user = await User.findOne({ username: String(username).toLowerCase().trim() }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw ApiError.unauthorized('Invalid username or password');
  }
  if (!user.active) throw ApiError.forbidden('Your account is disabled. Contact the administrator.');
  user.lastLoginAt = new Date();
  await user.save();
  const accessToken = signAccess(user);
  const refreshToken = await issueRefresh(user, req);
  await audit.log({ ...req, user, companyId: user.companyId, ip: req.ip, headers: req.headers }, { action: 'auth.login', entity: 'User', entityId: user._id, refNo: user.username });
  return { accessToken, refreshToken, ...(await profile(user._id)) };
}

async function refresh(req, token) {
  if (!token) throw ApiError.unauthorized('No refresh token');
  const doc = await RefreshToken.findOne({ tokenHash: hash(token) });
  if (!doc || doc.expiresAt < new Date()) throw ApiError.unauthorized('Session expired, please login again');
  if (doc.revokedAt) {
    // token reuse => revoke the whole family for safety, unless it was rotated within the last few seconds
    // (two tabs refreshing concurrently)
    if (Date.now() - doc.revokedAt.getTime() > 15000) {
      await RefreshToken.updateMany({ userId: doc.userId, revokedAt: null }, { revokedAt: new Date() });
    }
    throw ApiError.unauthorized('Session expired, please login again');
  }
  const user = await User.findById(doc.userId);
  if (!user || !user.active) throw ApiError.unauthorized('Account disabled');
  const newToken = await issueRefresh(user, req);
  doc.revokedAt = new Date();
  doc.replacedBy = hash(newToken);
  await doc.save();
  return { accessToken: signAccess(user), refreshToken: newToken, ...(await profile(user._id)) };
}

async function logout(req, token) {
  if (token) await RefreshToken.updateOne({ tokenHash: hash(token) }, { revokedAt: new Date() });
  if (req.user) await audit.log(req, { action: 'auth.logout', entity: 'User', entityId: req.user._id, refNo: req.user.username });
}

async function changePassword(req, { currentPassword, newPassword }) {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw ApiError.badRequest('Current password is incorrect');
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.tokenVersion += 1;
  await user.save();
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  await audit.log(req, { action: 'user.password_change', entity: 'User', entityId: user._id, refNo: user.username });
}

module.exports = { login, refresh, logout, profile, changePassword };
