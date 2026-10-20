const mongoose = require('mongoose');
const { Sale, SaleItem, SaleReturn, Purchase, Stock, Customer, Supplier, StockTransfer, Branch } = require('../models');
const { round2, startOfDay } = require('../utils/common');
const settingsService = require('./settings.service');

const TZ = process.env.REPORT_TZ || 'Asia/Kolkata';

async function summary(req) {
  const companyId = new mongoose.Types.ObjectId(String(req.companyId));
  const branch = { ...req.branchScope };
  if (!branch.branchId && req.allowedBranchIds) branch.branchId = { $in: req.allowedBranchIds.map((b) => new mongoose.Types.ObjectId(b)) };
  const today = startOfDay(new Date());
  const days30 = new Date(today.getTime() - 29 * 86400000);
  const months12 = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const settings = await settingsService.get(req.companyId);
  const low = settings.stock.lowStockThreshold;
  const base = { companyId, ...branch, status: 'completed' };

  const [
    todaySales, todayItems, todayReturns, todayPurchase, stockAgg, lowStock, outStock, receivables, payables,
    daily, monthly, byBranch, byCategory, byPayment, topProducts, pendingTransfers, recentSales,
  ] = await Promise.all([
    Sale.aggregate([{ $match: { ...base, createdAt: { $gte: today } } }, { $group: { _id: null, amount: { $sum: '$totals.grandTotal' }, bills: { $sum: 1 }, taxable: { $sum: '$totals.taxable' }, cost: { $sum: '$costTotal' } } }]),
    SaleItem.aggregate([{ $match: { ...base, createdAt: { $gte: today } } }, { $group: { _id: null, qty: { $sum: '$qty' } } }]),
    SaleReturn.aggregate([{ $match: { companyId, ...branch, createdAt: { $gte: today } } }, { $group: { _id: null, amount: { $sum: '$amount' }, taxable: { $sum: '$taxable' }, cost: { $sum: '$costTotal' } } }]),
    Purchase.aggregate([{ $match: { companyId, ...branch, status: 'received', receivedAt: { $gte: today } } }, { $group: { _id: null, amount: { $sum: '$totals.grandTotal' }, count: { $sum: 1 } } }]),
    Stock.aggregate([
      { $match: { companyId, ...branch, current: { $gt: 0 } } },
      { $lookup: { from: 'productvariants', localField: 'variantId', foreignField: '_id', as: 'v', pipeline: [{ $project: { purchasePrice: 1, mrp: 1 } }] } }, { $unwind: '$v' },
      { $group: { _id: null, qty: { $sum: '$current' }, value: { $sum: { $multiply: ['$current', { $cond: [{ $gt: ['$avgCost', 0] }, '$avgCost', '$v.purchasePrice'] }] } }, mrpValue: { $sum: { $multiply: ['$current', '$v.mrp'] } } } },
    ]),
    Stock.countDocuments({ companyId, ...branch, current: { $gt: 0, $lte: low } }),
    Stock.countDocuments({ companyId, ...branch, current: { $lte: 0 } }),
    Customer.aggregate([{ $match: { companyId, outstanding: { $gt: 0 } } }, { $group: { _id: null, amount: { $sum: '$outstanding' }, count: { $sum: 1 } } }]),
    Supplier.aggregate([{ $match: { companyId, balance: { $gt: 0 } } }, { $group: { _id: null, amount: { $sum: '$balance' }, count: { $sum: 1 } } }]),
    Sale.aggregate([{ $match: { ...base, createdAt: { $gte: days30 } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }, amount: { $sum: '$totals.grandTotal' }, bills: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Sale.aggregate([{ $match: { ...base, createdAt: { $gte: months12 } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: TZ } }, amount: { $sum: '$totals.grandTotal' }, bills: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Sale.aggregate([{ $match: { ...base, createdAt: { $gte: days30 } } }, { $group: { _id: '$branchId', amount: { $sum: '$totals.grandTotal' }, bills: { $sum: 1 } } }]),
    SaleItem.aggregate([{ $match: { ...base, createdAt: { $gte: days30 } } }, { $group: { _id: '$categoryName', amount: { $sum: '$amount' }, qty: { $sum: '$qty' } } }, { $sort: { amount: -1 } }, { $limit: 8 }]),
    Sale.aggregate([{ $match: { ...base, createdAt: { $gte: days30 } } }, { $unwind: '$payments' }, { $match: { 'payments.mode': { $ne: 'exchange' } } }, { $group: { _id: '$payments.mode', amount: { $sum: '$payments.amount' } } }, { $sort: { amount: -1 } }]),
    SaleItem.aggregate([{ $match: { ...base, createdAt: { $gte: days30 } } }, { $group: { _id: '$productId', name: { $first: '$productName' }, qty: { $sum: '$qty' }, amount: { $sum: '$amount' } } }, { $sort: { qty: -1 } }, { $limit: 8 }]),
    StockTransfer.countDocuments({ companyId, status: 'sent', ...(req.branchId ? { toBranchId: req.branchId } : {}) }),
    Sale.find({ companyId, ...branch }).sort({ createdAt: -1 }).limit(8).select('invoiceNumber createdAt totals.grandTotal customer.name cashierName status branchId').populate('branchId', 'name').lean(),
  ]);

  const branches = await Branch.find({ companyId }).select('name').lean();
  const bn = new Map(branches.map((b) => [String(b._id), b.name]));
  const ts = todaySales[0] || {};
  const tr = todayReturns[0] || {};
  const profit = round2((ts.taxable || 0) - (ts.cost || 0) - ((tr.taxable || 0) - (tr.cost || 0)));

  // fill gaps in daily series
  const dmap = new Map(daily.map((d) => [d._id, d]));
  const dailySeries = [];
  for (let i = 0; i < 30; i += 1) {
    const d = new Date(days30.getTime() + i * 86400000);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
    dailySeries.push({ date: key, amount: round2(dmap.get(key)?.amount || 0), bills: dmap.get(key)?.bills || 0 });
  }

  return {
    cards: {
      todaySales: round2((ts.amount || 0) - (tr.amount || 0)),
      grossSales: round2(ts.amount || 0),
      todayReturns: round2(tr.amount || 0),
      todayBills: ts.bills || 0,
      todayItems: todayItems[0]?.qty || 0,
      todayProfit: profit,
      todayPurchase: round2(todayPurchase[0]?.amount || 0),
      stockValue: round2(stockAgg[0]?.value || 0),
      stockQty: stockAgg[0]?.qty || 0,
      stockMrpValue: round2(stockAgg[0]?.mrpValue || 0),
      lowStock,
      outOfStock: outStock,
      receivables: round2(receivables[0]?.amount || 0),
      payables: round2(payables[0]?.amount || 0),
      pendingPayments: round2((receivables[0]?.amount || 0) + (payables[0]?.amount || 0)),
      pendingTransfers,
    },
    charts: {
      daily: dailySeries,
      monthly: monthly.map((m) => ({ month: m._id, amount: round2(m.amount), bills: m.bills })),
      branch: byBranch.map((b) => ({ branch: bn.get(String(b._id)) || 'Unknown', amount: round2(b.amount), bills: b.bills })).sort((a, b) => b.amount - a.amount),
      category: byCategory.map((c) => ({ category: c._id || 'Other', amount: round2(c.amount), qty: c.qty })),
      payment: byPayment.map((p) => ({ mode: p._id.toUpperCase(), amount: round2(p.amount) })),
      topProducts: topProducts.map((p) => ({ name: p.name, qty: p.qty, amount: round2(p.amount) })),
    },
    recentSales,
  };
}

module.exports = { summary };
