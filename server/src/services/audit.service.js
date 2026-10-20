const { AuditLog } = require('../models');
const { paginate, dateRange, escapeRegex } = require('../utils/common');

const strip = (v) => {
  if (v == null) return v;
  const o = JSON.parse(JSON.stringify(v));
  delete o.passwordHash;
  delete o.searchText;
  delete o.__v;
  return o;
};

/** Records an audit entry. ctx is the express req (or a {user, companyId, ip} object). Never throws. */
async function log(ctx, { action, entity, entityId, refNo, oldValue, newValue, branchId }, session = null) {
  try {
    const user = ctx.user || {};
    await AuditLog.create([{
      companyId: ctx.companyId || user.companyId,
      branchId: branchId || ctx.branchId || undefined,
      userId: user._id,
      userName: user.name,
      action,
      entity,
      entityId,
      refNo,
      oldValue: strip(oldValue),
      newValue: strip(newValue),
      ip: ctx.ip || ctx.headers?.['x-forwarded-for'],
      userAgent: ctx.headers?.['user-agent'],
    }], { session });
  } catch (e) {
    if (session) throw e;
    console.error('[audit] failed', e.message);
  }
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to) };
  if (q.action) filter.action = q.action;
  if (q.userId) filter.userId = q.userId;
  if (q.entity) filter.entity = q.entity;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ refNo: rx }, { userName: rx }, { action: rx }];
  }
  // branch-scoped users must not see company-level logs without a branch
  if (req.branchScope.branchId) filter.branchId = req.branchScope.branchId;
  return paginate(AuditLog, filter, q);
}

const actions = (req) => AuditLog.distinct('action', { companyId: req.companyId });

module.exports = { log, list, actions };
