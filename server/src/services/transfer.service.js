const { StockTransfer, StockTransferItem, ProductVariant, Branch } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, dateRange, escapeRegex, round2 } = require('../utils/common');
const { runInTransaction } = require('../utils/transaction');
const settingsService = require('./settings.service');
const stockService = require('./stock.service');
const audit = require('./audit.service');

const canAccess = (req, branchId) => !req.allowedBranchIds || req.allowedBranchIds.includes(String(branchId));
const hist = (req, status, note) => ({ status, at: new Date(), userId: req.user._id, userName: req.user.name, note });

async function buildItems(req, session, transfer, items) {
  const ids = items.map((i) => i.variantId);
  const variants = await ProductVariant.find({ _id: { $in: ids }, companyId: req.companyId, deletedAt: null }).session(session).lean();
  const vm = new Map(variants.map((v) => [String(v._id), v]));
  const stockMap = await stockService.getStockMap(transfer.fromBranchId, ids, session);
  const seen = new Set();
  return items.map((it) => {
    const v = vm.get(String(it.variantId));
    if (!v) throw ApiError.badRequest('Product not found');
    if (seen.has(String(v._id))) throw ApiError.badRequest(`${v.sku} is added more than once`);
    seen.add(String(v._id));
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty <= 0) throw ApiError.badRequest(`Invalid quantity for ${v.sku}`);
    const available = stockMap.get(String(v._id))?.current || 0;
    if (qty > available) throw ApiError.badRequest(`Transfer qty for ${v.productName} ${v.color || ''} ${v.size || ''} exceeds available stock (${available})`);
    return {
      companyId: req.companyId, transferId: transfer._id, variantId: v._id, productId: v.productId, productName: v.productName,
      sku: v.sku, barcode: v.barcode, size: v.size, color: v.color, qty, costPrice: stockMap.get(String(v._id))?.avgCost || v.purchasePrice || 0,
    };
  });
}

async function validateBranches(req, from, to, session) {
  if (String(from) === String(to)) throw ApiError.badRequest('Source and destination branch must be different');
  if (!canAccess(req, from)) throw ApiError.forbidden('You do not have access to the source branch');
  const n = await Branch.countDocuments({ companyId: req.companyId, _id: { $in: [from, to] }, active: true }).session(session);
  if (n !== 2) throw ApiError.badRequest('Invalid branch selection');
}

async function sendInternal(session, req, transfer) {
  const items = await StockTransferItem.find({ transferId: transfer._id }).session(session);
  for (const it of items) {
    await stockService.applyMovement({
      session, companyId: req.companyId, branchId: transfer.fromBranchId, variant: { _id: it.variantId, productId: it.productId, productName: it.productName, sku: it.sku, size: it.size, color: it.color },
      qty: -it.qty, type: 'transfer_out', refType: 'StockTransfer', refId: transfer._id, refNo: transfer.transferNo, userId: req.user._id, allowNegative: false,
      costPrice: it.costPrice,
    });
  }
  transfer.status = 'sent';
  transfer.sentBy = req.user._id;
  transfer.sentAt = new Date();
  transfer.history.push(hist(req, 'sent'));
  await transfer.save({ session });
}

async function create(req, data) {
  const result = await runInTransaction(async (session) => {
    await validateBranches(req, data.fromBranchId, data.toBranchId, session);
    const transferNo = await settingsService.nextNumber(req.companyId, 'transfer', { branchId: data.fromBranchId, session });
    const [transfer] = await StockTransfer.create([{
      companyId: req.companyId, transferNo, fromBranchId: data.fromBranchId, toBranchId: data.toBranchId, status: 'draft',
      notes: data.notes, createdBy: req.user._id, history: [hist(req, 'draft')],
    }], { session });
    const docs = await buildItems(req, session, transfer, data.items);
    await StockTransferItem.insertMany(docs, { session });
    transfer.totalItems = docs.length;
    transfer.totalQty = docs.reduce((a, d) => a + d.qty, 0);
    transfer.totalValue = round2(docs.reduce((a, d) => a + d.qty * d.costPrice, 0));
    await transfer.save({ session });
    if (data.send) await sendInternal(session, req, transfer);
    return transfer;
  });
  await audit.log(req, { action: 'transfer.create', entity: 'StockTransfer', entityId: result._id, refNo: result.transferNo, branchId: result.fromBranchId, newValue: result.toObject() });
  return get(req, result._id);
}

async function updateDraft(req, id, data) {
  await runInTransaction(async (session) => {
    const transfer = await StockTransfer.findOne({ _id: id, companyId: req.companyId }).session(session);
    if (!transfer) throw ApiError.notFound('Transfer not found');
    if (transfer.status !== 'draft') throw ApiError.badRequest('Only draft transfers can be edited');
    await validateBranches(req, data.fromBranchId, data.toBranchId, session);
    Object.assign(transfer, { fromBranchId: data.fromBranchId, toBranchId: data.toBranchId, notes: data.notes });
    await StockTransferItem.deleteMany({ transferId: id }, { session });
    const docs = await buildItems(req, session, transfer, data.items);
    await StockTransferItem.insertMany(docs, { session });
    transfer.totalItems = docs.length;
    transfer.totalQty = docs.reduce((a, d) => a + d.qty, 0);
    transfer.totalValue = round2(docs.reduce((a, d) => a + d.qty * d.costPrice, 0));
    await transfer.save({ session });
    if (data.send) await sendInternal(session, req, transfer);
  });
  await audit.log(req, { action: 'transfer.update', entity: 'StockTransfer', entityId: id, newValue: data });
  return get(req, id);
}

async function send(req, id) {
  await runInTransaction(async (session) => {
    const transfer = await StockTransfer.findOne({ _id: id, companyId: req.companyId }).session(session);
    if (!transfer) throw ApiError.notFound('Transfer not found');
    if (!canAccess(req, transfer.fromBranchId)) throw ApiError.forbidden('Only the source branch can send this transfer');
    if (transfer.status !== 'draft') throw ApiError.badRequest(`Transfer is already ${transfer.status}`);
    await sendInternal(session, req, transfer);
  });
  const t = await get(req, id);
  await audit.log(req, { action: 'transfer.send', entity: 'StockTransfer', entityId: id, refNo: t.transferNo, branchId: t.fromBranchId._id, newValue: { status: 'sent' } });
  return t;
}

/** Destination receives: stock added to destination branch (received qty may be less -> shortage stays logged). */
async function receive(req, id, data = {}) {
  await runInTransaction(async (session) => {
    const transfer = await StockTransfer.findOne({ _id: id, companyId: req.companyId }).session(session);
    if (!transfer) throw ApiError.notFound('Transfer not found');
    if (!canAccess(req, transfer.toBranchId)) throw ApiError.forbidden('Only the destination branch can receive this transfer');
    if (transfer.status !== 'sent') throw ApiError.badRequest(`Transfer is ${transfer.status}; only sent transfers can be received`);
    const items = await StockTransferItem.find({ transferId: id }).session(session);
    const recMap = new Map((data.items || []).map((i) => [String(i.itemId), Number(i.receivedQty)]));
    const shortages = [];
    for (const it of items) {
      const rq = recMap.has(String(it._id)) ? recMap.get(String(it._id)) : it.qty;
      if (!Number.isInteger(rq) || rq < 0 || rq > it.qty) throw ApiError.badRequest(`Invalid received qty for ${it.sku} (0 - ${it.qty})`);
      it.receivedQty = rq;
      await it.save({ session });
      if (rq > 0) {
        await stockService.applyMovement({
          session, companyId: req.companyId, branchId: transfer.toBranchId, variant: { _id: it.variantId, productId: it.productId },
          qty: rq, type: 'transfer_in', refType: 'StockTransfer', refId: transfer._id, refNo: transfer.transferNo, userId: req.user._id, costPrice: it.costPrice,
        });
      }
      if (rq < it.qty) shortages.push(`${it.sku}: short ${it.qty - rq}`);
    }
    transfer.status = 'received';
    transfer.receivedBy = req.user._id;
    transfer.receivedAt = new Date();
    transfer.history.push(hist(req, 'received', [data.note, shortages.length ? `Shortage - ${shortages.join(', ')}` : ''].filter(Boolean).join(' | ')));
    await transfer.save({ session });
  });
  const t = await get(req, id);
  await audit.log(req, { action: 'transfer.receive', entity: 'StockTransfer', entityId: id, refNo: t.transferNo, branchId: t.toBranchId._id, newValue: { status: 'received', items: t.items.map((i) => ({ sku: i.sku, qty: i.qty, receivedQty: i.receivedQty })) } });
  return t;
}

/** Cancel: draft -> nothing to reverse; sent -> stock returned to source branch. */
async function cancel(req, id, reason) {
  await runInTransaction(async (session) => {
    const transfer = await StockTransfer.findOne({ _id: id, companyId: req.companyId }).session(session);
    if (!transfer) throw ApiError.notFound('Transfer not found');
    if (!canAccess(req, transfer.fromBranchId)) throw ApiError.forbidden('Only the source branch can cancel this transfer');
    if (!['draft', 'sent'].includes(transfer.status)) throw ApiError.badRequest(`A ${transfer.status} transfer cannot be cancelled`);
    if (transfer.status === 'sent') {
      const items = await StockTransferItem.find({ transferId: id }).session(session);
      for (const it of items) {
        await stockService.applyMovement({
          session, companyId: req.companyId, branchId: transfer.fromBranchId, variant: { _id: it.variantId, productId: it.productId },
          qty: it.qty, type: 'transfer_out', refType: 'StockTransfer', refId: transfer._id, refNo: transfer.transferNo, userId: req.user._id,
          note: 'Transfer cancelled - stock returned to source',
        });
      }
    }
    transfer.status = 'cancelled';
    transfer.cancelledBy = req.user._id;
    transfer.cancelledAt = new Date();
    transfer.cancelReason = reason;
    transfer.history.push(hist(req, 'cancelled', reason));
    await transfer.save({ session });
  });
  const t = await get(req, id);
  await audit.log(req, { action: 'transfer.cancel', entity: 'StockTransfer', entityId: id, refNo: t.transferNo, newValue: { reason } });
  return t;
}

async function get(req, id) {
  const t = await StockTransfer.findOne({ _id: id, companyId: req.companyId })
    .populate('fromBranchId', 'name code').populate('toBranchId', 'name code').populate('createdBy', 'name').lean();
  if (!t) throw ApiError.notFound('Transfer not found');
  if (!canAccess(req, t.fromBranchId._id) && !canAccess(req, t.toBranchId._id)) throw ApiError.forbidden();
  const items = await StockTransferItem.find({ transferId: id }).lean();
  const sm = await stockService.getStockMap(t.fromBranchId._id, items.map((i) => i.variantId));
  return { ...t, items: items.map((i) => ({ ...i, sourceStock: sm.get(String(i.variantId))?.current || 0 })) };
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...dateRange(q.from, q.to) };
  const b = req.branchId ? String(req.branchId) : null;
  if (q.direction === 'in' && b) filter.toBranchId = req.branchId;
  else if (q.direction === 'out' && b) filter.fromBranchId = req.branchId;
  else if (b) filter.$or = [{ fromBranchId: req.branchId }, { toBranchId: req.branchId }];
  else if (req.allowedBranchIds) filter.$or = [{ fromBranchId: { $in: req.allowedBranchIds } }, { toBranchId: { $in: req.allowedBranchIds } }];
  if (q.status) filter.status = q.status;
  if (q.search) filter.transferNo = new RegExp(escapeRegex(q.search), 'i');
  return paginate(StockTransfer, filter, q, { populate: [{ path: 'fromBranchId', select: 'name code' }, { path: 'toBranchId', select: 'name code' }, { path: 'createdBy', select: 'name' }] });
}

module.exports = { create, updateDraft, send, receive, cancel, get, list };
