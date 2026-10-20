const { Settings, Counter, Branch } = require('../models');
const audit = require('./audit.service');

const cache = new Map(); // companyId -> { at, doc }
const TTL = 30 * 1000;

async function get(companyId, session = null) {
  const key = String(companyId);
  const hit = cache.get(key);
  if (!session && hit && Date.now() - hit.at < TTL) return hit.doc;
  let doc = await Settings.findOne({ companyId }).session(session).lean();
  if (!doc) {
    [doc] = await Settings.create([{ companyId }], { session });
    doc = doc.toObject();
  }
  if (!session) cache.set(key, { at: Date.now(), doc });
  return doc;
}

const SECTIONS = ['invoice', 'tax', 'barcode', 'printer', 'payment', 'discount', 'stock', 'loyalty', 'returnPolicy', 'exchangePolicy', 'cash', 'numberSeries'];

async function update(req, section, data) {
  if (!SECTIONS.includes(section)) throw require('../utils/ApiError').badRequest('Unknown settings section');
  const before = await get(req.companyId);
  const set = {};
  for (const [k, v] of Object.entries(data)) set[`${section}.${k}`] = v;
  const doc = await Settings.findOneAndUpdate({ companyId: req.companyId }, { $set: set }, { new: true, runValidators: true, upsert: true }).lean();
  cache.delete(String(req.companyId));
  await audit.log(req, { action: 'settings.update', entity: 'Settings', entityId: doc._id, refNo: section, oldValue: before[section], newValue: doc[section] });
  return doc;
}

function fyLabel(d) {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Generates the next number of a series atomically (e.g. INV-2026-000001).
 * Tokens: {YYYY} {YY} {MM} {FY} {BRANCH} {SEQ:n}
 */
async function nextNumber(companyId, series, { branchId, session = null } = {}) {
  const settings = await get(companyId);
  const cfg = settings.numberSeries?.[series];
  if (!cfg) throw new Error(`Number series "${series}" not configured`);
  const now = new Date();
  let branchCode = '';
  if (branchId && (cfg.scope === 'branch' || cfg.pattern.includes('{BRANCH}'))) {
    const b = await Branch.findById(branchId).select('code').session(session).lean();
    branchCode = b?.code || '';
  }
  const period = cfg.reset === 'yearly' ? String(now.getFullYear()) : cfg.reset === 'financial_year' ? fyLabel(now) : 'all';
  const scopeKey = cfg.scope === 'branch' ? String(branchId) : 'company';
  const key = `${companyId}:${series}:${scopeKey}:${period}`;
  const c = await Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { new: true, upsert: true, session });
  return cfg.pattern
    .replace('{YYYY}', String(now.getFullYear()))
    .replace('{YY}', String(now.getFullYear()).slice(2))
    .replace('{MM}', String(now.getMonth() + 1).padStart(2, '0'))
    .replace('{FY}', fyLabel(now))
    .replace('{BRANCH}', branchCode)
    .replace(/\{SEQ:(\d+)\}/, (m, n) => String(c.seq).padStart(Number(n), '0'))
    .replace('{SEQ}', String(c.seq));
}

/** Plain counter (used for barcode sequences). */
async function nextSeq(key, session = null) {
  const c = await Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { new: true, upsert: true, session });
  return c.seq;
}

module.exports = { get, update, nextNumber, nextSeq, SECTIONS, clearCache: () => cache.clear() };
