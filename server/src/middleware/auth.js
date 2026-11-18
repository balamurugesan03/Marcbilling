const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { User } = require('../models');
const { normalizePermissions, ALL_PERMISSIONS } = require('../constants/permissions');

/**
 * Verifies the access token and loads the user + role.
 * Sets req.user, req.role, req.companyId, req.perms (Set), and resolves the selected branch scope:
 *   header `x-branch-id: <id>|all`
 *   req.branchId    -> selected branch (null when "all")
 *   req.branchScope -> filter fragment for queries ({} for all branches, or { branchId })
 *   req.allowedBranchIds -> branches the user may access (null = all company branches)
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.access_token;
    if (!token) throw ApiError.unauthorized();
    let payload;
    try {
      payload = jwt.verify(token, env.jwtAccessSecret);
    } catch {
      throw ApiError.unauthorized('Session expired, please login again');
    }
    const user = await User.findById(payload.sub).populate('roleId').lean();
    if (!user || !user.active) throw ApiError.unauthorized('Account disabled');
    if (user.tokenVersion !== payload.tv) throw ApiError.unauthorized('Session revoked, please login again');
    if (!user.roleId) throw ApiError.forbidden('No role assigned');

    req.user = user;
    req.role = user.roleId;
    req.companyId = user.companyId;
    // Super Admin always has every permission, including ones added after the role was created
    req.perms = new Set(user.roleId.code === 'super_admin' ? ALL_PERMISSIONS : normalizePermissions(user.roleId.permissions || []));
    req.isSuperAdmin = user.roleId.code === 'super_admin';
    req.allowedBranchIds = user.roleId.allBranches ? null : (user.branchIds || []).map(String);

    const requested = req.headers['x-branch-id'];
    if (requested && requested !== 'all') {
      if (!mongoose.isValidObjectId(requested)) throw ApiError.badRequest('Invalid branch');
      if (req.allowedBranchIds && !req.allowedBranchIds.includes(String(requested))) {
        throw ApiError.forbidden('You do not have access to this branch');
      }
      req.branchId = new mongoose.Types.ObjectId(requested);
      req.branchScope = { branchId: req.branchId };
    } else if (requested === 'all' && !req.allowedBranchIds) {
      req.branchId = null;
      req.branchScope = {};
    } else {
      // default: user's default / first branch (users limited to branches never get "all")
      const fallback = user.defaultBranchId || (user.branchIds || [])[0];
      if (req.allowedBranchIds) {
        if (!fallback) throw ApiError.forbidden('No branch assigned to your account');
        req.branchId = new mongoose.Types.ObjectId(String(fallback));
        req.branchScope = { branchId: req.branchId };
      } else {
        req.branchId = null;
        req.branchScope = {};
      }
    }
    req.scope = { companyId: req.companyId, ...req.branchScope };
    next();
  } catch (e) {
    next(e);
  }
}

/** Requires at least one of the given permissions. */
const permit = (...keys) => (req, res, next) => {
  if (keys.some((k) => req.perms.has(k))) return next();
  next(ApiError.forbidden(`Permission denied (${keys.join(' / ')})`));
};

/** Requires a specific branch to be selected (for transactional operations like billing). */
const requireBranch = (req, res, next) => {
  if (!req.branchId) return next(ApiError.badRequest('Select a specific branch (not "All Branches") to perform this action'));
  next();
};

/** Checks that a branch id (from body) is accessible by the user. */
function assertBranchAccess(req, branchId) {
  if (!branchId) throw ApiError.badRequest('Branch is required');
  if (req.allowedBranchIds && !req.allowedBranchIds.includes(String(branchId))) {
    throw ApiError.forbidden('You do not have access to this branch');
  }
}

module.exports = { authenticate, permit, requireBranch, assertBranchAccess };
