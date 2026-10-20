const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const sum = (arr, fn = (x) => x) => round2(arr.reduce((a, x) => a + Number(fn(x) || 0), 0));

function parsePaging(query, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

const SORT_SAFE = /^[a-zA-Z0-9_.]+$/;
async function paginate(Model, filter, query, { populate, select, defaultSort = { createdAt: -1 } } = {}) {
  const { page, limit, skip } = parsePaging(query);
  const sort = query.sortBy && SORT_SAFE.test(query.sortBy)
    ? { [query.sortBy]: query.sortDir === 'asc' ? 1 : -1, _id: -1 }
    : { ...defaultSort, _id: -1 };
  let q = Model.find(filter).sort(sort).skip(skip).limit(limit);
  if (select) q = q.select(select);
  if (populate) (Array.isArray(populate) ? populate : [populate]).forEach((p) => { q = q.populate(p); });
  const [items, total] = await Promise.all([q.lean(), Model.countDocuments(filter)]);
  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

const escapeRegex = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function dateRange(from, to, field = 'createdAt') {
  if (!from && !to) return {};
  const r = {};
  if (from) r.$gte = startOfDay(from);
  if (to) r.$lte = endOfDay(to);
  return { [field]: r };
}

const pick = (obj, keys) => keys.reduce((a, k) => { if (obj[k] !== undefined) a[k] = obj[k]; return a; }, {});

module.exports = { asyncHandler, round2, sum, parsePaging, paginate, escapeRegex, startOfDay, endOfDay, dateRange, pick };
