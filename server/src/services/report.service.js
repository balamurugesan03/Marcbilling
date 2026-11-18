const mongoose = require('mongoose');
const {
  Sale, SaleItem, SaleReturn, Stock, Purchase, PurchaseItem, PurchaseReturn, Customer, Expense, Payment,
  StockTransferItem, StockAdjustment, Branch, ProductVariant,
} = require('../models');
const ApiError = require('../utils/ApiError');
const { round2, startOfDay, endOfDay, escapeRegex } = require('../utils/common');
const settingsService = require('./settings.service');

const TZ = process.env.REPORT_TZ || 'Asia/Kolkata';
const oid = (v) => new mongoose.Types.ObjectId(String(v));

const C = (key, label, type = 'text') => ({ key, label, type }); // type: text | number | money | date | percent
const money = (k, l) => C(k, l, 'money');
const num = (k, l) => C(k, l, 'number');

function ctxFrom(req) {
  const q = req.query;
  const now = new Date();
  const from = q.from ? startOfDay(q.from) : startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = q.to ? endOfDay(q.to) : endOfDay(now);
  const branch = { ...req.branchScope };
  if (q.branchId && !branch.branchId) branch.branchId = oid(q.branchId);
  else if (branch.branchId) branch.branchId = oid(branch.branchId);
  if (!branch.branchId && req.allowedBranchIds) branch.branchId = { $in: req.allowedBranchIds.map(oid) };
  const all = q.all === 'true';
  const page = Math.max(1, Number(q.page) || 1);
  const limit = all ? 100000 : Math.min(500, Number(q.limit) || 50);
  return { req, q, from, to, branch, companyId: oid(req.companyId), page, limit, search: (q.search || '').trim() };
}

/** Runs a pipeline with server-side pagination + totals in one round trip. */
async function facet(Model, pipeline, ctx, totalFields = []) {
  const totalsGroup = { _id: null, count: { $sum: 1 } };
  totalFields.forEach((f) => { totalsGroup[f] = { $sum: `$${f}` }; });
  const [res] = await Model.aggregate([
    ...pipeline,
    { $facet: { rows: [{ $skip: (ctx.page - 1) * ctx.limit }, { $limit: ctx.limit }], totals: [{ $group: totalsGroup }] } },
  ]).allowDiskUse(true);
  const t = res.totals[0] || { count: 0 };
  const totals = {};
  totalFields.forEach((f) => { totals[f] = round2(t[f] || 0); });
  return { rows: res.rows, totals, total: t.count, page: ctx.page, pages: Math.ceil(t.count / ctx.limit) || 1 };
}

const saleMatch = (ctx, extra = {}) => ({ companyId: ctx.companyId, ...ctx.branch, status: 'completed', createdAt: { $gte: ctx.from, $lte: ctx.to }, ...extra });
const itemSearch = (ctx) => (ctx.search ? [{ $match: { $or: [{ productName: new RegExp(escapeRegex(ctx.search), 'i') }, { sku: ctx.search.toUpperCase() }, { barcode: ctx.search }] } }] : []);
const dayKey = (field = '$createdAt') => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TZ } });
const monthKey = (field = '$createdAt') => ({ $dateToString: { format: '%Y-%m', date: field, timezone: TZ } });

/** Group SaleItems by a dimension (product / category / brand / size / color). */
function saleItemsBy(groupId, labelProject, ctx) {
  return [
    { $match: saleMatch(ctx) },
    ...itemSearch(ctx),
    {
      $group: {
        _id: groupId, ...labelProject.group,
        qty: { $sum: '$qty' }, returnedQty: { $sum: '$returnedQty' }, bills: { $addToSet: '$saleId' },
        discount: { $sum: '$discount' }, taxable: { $sum: '$taxable' }, tax: { $sum: '$taxAmount' }, amount: { $sum: '$amount' },
        cost: { $sum: { $multiply: ['$costPrice', '$qty'] } },
      },
    },
    {
      $project: {
        _id: 0, ...labelProject.project, qty: 1, returnedQty: 1, netQty: { $subtract: ['$qty', '$returnedQty'] }, bills: { $size: '$bills' },
        discount: { $round: ['$discount', 2] }, taxable: { $round: ['$taxable', 2] }, tax: { $round: ['$tax', 2] }, amount: { $round: ['$amount', 2] },
        profit: { $round: [{ $subtract: ['$taxable', '$cost'] }, 2] },
      },
    },
    { $sort: { amount: -1 } },
  ];
}
const dimCols = (first) => [...first, num('qty', 'Qty Sold'), num('returnedQty', 'Returned'), num('netQty', 'Net Qty'), num('bills', 'Bills'), money('discount', 'Discount'), money('taxable', 'Taxable'), money('tax', 'GST'), money('amount', 'Amount'), money('profit', 'Gross Profit')];
const dimTotals = ['qty', 'returnedQty', 'netQty', 'bills', 'discount', 'taxable', 'tax', 'amount', 'profit'];

/** Sales grouped by a date key, net of returns. */
async function salesByPeriod(ctx, keyFn) {
  // amount a bill took in one payment mode (refunds are minus)
  const paid = (modes) => ({ $sum: { $reduce: { input: { $filter: { input: '$payments', cond: { $in: ['$this.mode', modes] } } }, initialValue: 0, in: { $add: ['$value', '$this.amount'] } } } });
  const sales = await Sale.aggregate([
    { $match: saleMatch(ctx) },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: keyFn('$createdAt'), bills: { $sum: 1 }, qty: { $sum: '$totals.totalQty' }, gross: { $sum: '$totals.subtotal' },
        discount: { $sum: '$totals.discount' }, taxable: { $sum: '$totals.taxable' }, tax: { $sum: '$totals.totalTax' }, total: { $sum: '$totals.grandTotal' },
        firstBill: { $first: '$invoiceNumber' }, lastBill: { $last: '$invoiceNumber' },
        cash: paid(['cash']), upi: paid(['upi']), card: paid(['card']), other: paid(['bank', 'credit', 'store_credit', 'loyalty', 'exchange']),
      },
    },
  ]);
  const rets = await SaleReturn.aggregate([
    { $match: { companyId: ctx.companyId, ...ctx.branch, createdAt: { $gte: ctx.from, $lte: ctx.to } } },
    { $group: { _id: keyFn('$createdAt'), returns: { $sum: '$amount' }, returnTaxable: { $sum: '$taxable' } } },
  ]);
  const rm = new Map(rets.map((r) => [r._id, r]));
  const keys = [...new Set([...sales.map((s) => s._id), ...rets.map((r) => r._id)])].sort().reverse();
  const rows = keys.map((k) => {
    const s = sales.find((x) => x._id === k) || {};
    const r = rm.get(k) || {};
    return {
      period: k, billNos: s.firstBill ? (s.firstBill === s.lastBill ? s.firstBill : `${s.firstBill} – ${s.lastBill}`) : '',
      cash: round2(s.cash || 0), upi: round2(s.upi || 0), card: round2(s.card || 0), other: round2(s.other || 0),
      bills: s.bills || 0, qty: s.qty || 0, gross: round2(s.gross || 0), discount: round2(s.discount || 0), taxable: round2(s.taxable || 0),
      tax: round2(s.tax || 0), total: round2(s.total || 0), returns: round2(r.returns || 0), net: round2((s.total || 0) - (r.returns || 0)),
    };
  });
  return paginateRows(rows, ctx, ['bills', 'qty', 'gross', 'discount', 'taxable', 'tax', 'total', 'returns', 'net', 'cash', 'upi', 'card', 'other']);
}

function paginateRows(rows, ctx, totalFields) {
  const totals = {};
  totalFields.forEach((f) => { totals[f] = round2(rows.reduce((a, r) => a + (Number(r[f]) || 0), 0)); });
  const start = (ctx.page - 1) * ctx.limit;
  return { rows: rows.slice(start, start + ctx.limit), totals, total: rows.length, page: ctx.page, pages: Math.ceil(rows.length / ctx.limit) || 1 };
}

const periodCols = (label) => [C('period', label), num('bills', 'Bills'), num('qty', 'Items'), money('gross', 'Gross'), money('discount', 'Discount'), money('taxable', 'Taxable'), money('tax', 'GST'), money('total', 'Sales'), money('returns', 'Returns'), money('net', 'Net Sales')];

/* payment-mode filter (?mode=cash|upi|card|digital|credit…): bills that were paid, fully or partly, that way */
const MODE_NAMES = { cash: 'CASH', upi: 'GPAY', card: 'CARD', bank: 'BANK', credit: 'CREDIT', store_credit: 'STORE CREDIT', loyalty: 'LOYALTY', exchange: 'EXCHANGE' };
const modeName = (m) => MODE_NAMES[m] || String(m).toUpperCase();
function modeMatch(ctx) {
  const m = ctx.q.mode;
  if (!m) return {};
  return { 'payments.mode': { $in: m === 'digital' ? ['upi', 'card'] : [m] } };
}
async function salesPaidBy(ctx) {
  if (!ctx.q.mode) return null;
  return Sale.find(saleMatch(ctx, modeMatch(ctx))).distinct('_id');
}
const gstTotals = (rows) => {
  const t = {};
  ['bills', 'qty', 'taxable', 'cgst', 'sgst', 'igst', 'tax', 'value'].forEach((k) => { t[k] = round2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)); });
  return t;
};

async function branchNames(companyId) {
  const bs = await Branch.find({ companyId }).select('name').lean();
  return new Map(bs.map((b) => [String(b._id), b.name]));
}

const REPORTS = {
  /* ---------------- SALES ---------------- */
  sales_daily: { group: 'Sales', title: 'Daily Sales', columns: periodCols('Date'), run: (ctx) => salesByPeriod(ctx, dayKey) },
  sales_monthly: { group: 'Sales', title: 'Monthly Sales', columns: periodCols('Month'), run: (ctx) => salesByPeriod(ctx, monthKey) },
  sales_datewise: {
    group: 'Sales', title: 'Date-wise Sales (Invoice Register)',
    columns: [C('date', 'Date', 'date'), C('invoiceNumber', 'Invoice'), C('branch', 'Branch'), C('customer', 'Customer'), C('cashier', 'Cashier'), num('qty', 'Items'), money('discount', 'Discount'), money('taxable', 'Taxable'), money('tax', 'GST'), money('total', 'Total'), C('payment', 'Payment'), C('status', 'Status')],
    run: async (ctx) => {
      const m = { companyId: ctx.companyId, ...ctx.branch, createdAt: { $gte: ctx.from, $lte: ctx.to } };
      if (ctx.search) m.$or = [{ invoiceNumber: new RegExp(escapeRegex(ctx.search), 'i') }, { 'customer.mobile': new RegExp(escapeRegex(ctx.search)) }];
      if (ctx.q.status) m.status = ctx.q.status;
      const bn = await branchNames(ctx.companyId);
      const r = await facet(Sale, [
        { $match: m }, { $sort: { createdAt: -1 } },
        {
          $project: {
            date: '$createdAt', invoiceNumber: 1, branchId: 1, customer: { $ifNull: ['$customer.name', 'Walk-in'] }, cashier: '$cashierName', qty: '$totals.totalQty',
            discount: '$totals.discount', taxable: '$totals.taxable', tax: '$totals.totalTax',
            total: { $cond: [{ $eq: ['$status', 'completed'] }, '$totals.grandTotal', 0] }, payments: 1, status: 1,
          },
        },
      ], ctx, ['qty', 'discount', 'taxable', 'tax', 'total']);
      r.rows = r.rows.map((x) => ({ ...x, branch: bn.get(String(x.branchId)), payment: (x.payments || []).map((p) => `${p.mode.toUpperCase()} ${p.amount}`).join(', ') }));
      return r;
    },
  },
  sales_statement: {
    group: 'Financial', financial: true, title: 'Sales Statement',
    columns: [C('date', 'Date', 'date'), C('invoiceNumber', 'Invoice No'), C('customer', 'Customer'), C('mobile', 'Mobile'), C('branch', 'Branch'), C('payment', 'Payment'), money('amount', 'Amount')],
    // Completed bills in date order; each day closes with a bold "Day total" row (excluded from the grand total).
    run: async (ctx) => {
      const m = saleMatch(ctx);
      if (ctx.search) m.$or = [{ invoiceNumber: new RegExp(escapeRegex(ctx.search), 'i') }, { 'customer.name': new RegExp(escapeRegex(ctx.search), 'i') }, { 'customer.mobile': new RegExp(escapeRegex(ctx.search)) }];
      const [sales, bn] = await Promise.all([
        Sale.aggregate([
          { $match: m }, { $sort: { createdAt: 1, invoiceNumber: 1 } },
          { $project: { day: dayKey(), createdAt: 1, invoiceNumber: 1, branchId: 1, customer: 1, payments: 1, amount: '$totals.grandTotal' } },
        ]).allowDiskUse(true),
        branchNames(ctx.companyId),
      ]);
      const rows = [];
      let grand = 0;
      let dayAmt = 0;
      let dayBills = 0;
      for (let i = 0; i < sales.length; i += 1) {
        const s = sales[i];
        rows.push({
          date: s.createdAt, invoiceNumber: s.invoiceNumber, customer: s.customer?.name || 'Walk-in', mobile: s.customer?.mobile || '',
          branch: bn.get(String(s.branchId)), payment: [...new Set((s.payments || []).map((p) => p.mode.toUpperCase()))].join(', '), amount: round2(s.amount),
        });
        grand += s.amount;
        dayAmt += s.amount;
        dayBills += 1;
        if (sales[i + 1]?.day !== s.day) {
          rows.push({ date: s.createdAt, invoiceNumber: `Day total (${dayBills} bill${dayBills > 1 ? 's' : ''})`, amount: round2(dayAmt), bold: true });
          dayAmt = 0;
          dayBills = 0;
        }
      }
      const r = paginateRows(rows, ctx, []);
      r.totals = { amount: round2(grand) };
      return r;
    },
  },
  sales_branch: {
    group: 'Sales', title: 'Branch-wise Sales',
    columns: [C('branch', 'Branch'), num('bills', 'Bills'), num('qty', 'Items'), money('discount', 'Discount'), money('taxable', 'Taxable'), money('tax', 'GST'), money('total', 'Sales'), money('returns', 'Returns'), money('net', 'Net'), money('avgBill', 'Avg Bill')],
    run: async (ctx) => {
      const [sales, rets, bn] = await Promise.all([
        Sale.aggregate([{ $match: saleMatch(ctx) }, { $group: { _id: '$branchId', bills: { $sum: 1 }, qty: { $sum: '$totals.totalQty' }, discount: { $sum: '$totals.discount' }, taxable: { $sum: '$totals.taxable' }, tax: { $sum: '$totals.totalTax' }, total: { $sum: '$totals.grandTotal' } } }]),
        SaleReturn.aggregate([{ $match: { companyId: ctx.companyId, ...ctx.branch, createdAt: { $gte: ctx.from, $lte: ctx.to } } }, { $group: { _id: '$branchId', returns: { $sum: '$amount' } } }]),
        branchNames(ctx.companyId),
      ]);
      const rm = new Map(rets.map((r) => [String(r._id), r.returns]));
      const rows = sales.map((s) => ({
        branch: bn.get(String(s._id)), bills: s.bills, qty: s.qty, discount: round2(s.discount), taxable: round2(s.taxable), tax: round2(s.tax), total: round2(s.total),
        returns: round2(rm.get(String(s._id)) || 0), net: round2(s.total - (rm.get(String(s._id)) || 0)), avgBill: round2(s.total / s.bills),
      })).sort((a, b) => b.total - a.total);
      return paginateRows(rows, ctx, ['bills', 'qty', 'discount', 'taxable', 'tax', 'total', 'returns', 'net']);
    },
  },
  sales_product: {
    group: 'Sales', title: 'Product-wise Sales',
    columns: dimCols([C('productName', 'Product'), C('sku', 'SKU'), C('size', 'Size'), C('color', 'Color')]),
    run: (ctx) => facet(SaleItem, saleItemsBy('$variantId', { group: { productName: { $first: '$productName' }, sku: { $first: '$sku' }, size: { $first: '$size' }, color: { $first: '$color' } }, project: { productName: 1, sku: 1, size: 1, color: 1 } }, ctx), ctx, dimTotals),
  },
  sales_category: {
    group: 'Sales', title: 'Category-wise Sales', columns: dimCols([C('category', 'Category')]),
    run: (ctx) => facet(SaleItem, saleItemsBy('$categoryId', { group: { category: { $first: '$categoryName' } }, project: { category: 1 } }, ctx), ctx, dimTotals),
  },
  sales_brand: {
    group: 'Sales', title: 'Brand-wise Sales', columns: dimCols([C('brand', 'Brand')]),
    run: (ctx) => facet(SaleItem, saleItemsBy('$brandId', { group: { brand: { $first: { $ifNull: ['$brandName', 'Unbranded'] } } }, project: { brand: 1 } }, ctx), ctx, dimTotals),
  },
  sales_size: {
    group: 'Sales', title: 'Size-wise Sales', columns: dimCols([C('size', 'Size')]),
    run: (ctx) => facet(SaleItem, saleItemsBy({ $ifNull: ['$size', '-'] }, { group: { size: { $first: '$size' } }, project: { size: 1 } }, ctx), ctx, dimTotals),
  },
  sales_color: {
    group: 'Sales', title: 'Color-wise Sales', columns: dimCols([C('color', 'Color')]),
    run: (ctx) => facet(SaleItem, saleItemsBy({ $toLower: { $ifNull: ['$color', '-'] } }, { group: { color: { $first: '$color' } }, project: { color: 1 } }, ctx), ctx, dimTotals),
  },
  sales_cashier: {
    group: 'Sales', title: 'Cashier-wise Sales',
    columns: [C('cashier', 'Cashier'), num('bills', 'Bills'), num('qty', 'Items'), money('discount', 'Discount'), money('total', 'Sales'), money('avgBill', 'Avg Bill'), num('cancelled', 'Cancelled Bills')],
    run: async (ctx) => facet(Sale, [
      { $match: { companyId: ctx.companyId, ...ctx.branch, createdAt: { $gte: ctx.from, $lte: ctx.to } } },
      {
        $group: {
          _id: '$cashierId', cashier: { $first: '$cashierName' },
          bills: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          qty: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$totals.totalQty', 0] } },
          discount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$totals.discount', 0] } },
          total: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$totals.grandTotal', 0] } },
        },
      },
      { $project: { _id: 0, cashier: 1, bills: 1, cancelled: 1, qty: 1, discount: { $round: ['$discount', 2] }, total: { $round: ['$total', 2] }, avgBill: { $round: [{ $cond: [{ $gt: ['$bills', 0] }, { $divide: ['$total', '$bills'] }, 0] }, 2] } } },
      { $sort: { total: -1 } },
    ], ctx, ['bills', 'qty', 'discount', 'total', 'cancelled']),
  },
  sales_payment: {
    group: 'Sales', title: 'Payment-wise Sales',
    columns: [C('mode', 'Payment Mode'), num('bills', 'Bills'), money('amount', 'Amount'), C('share', 'Share %', 'percent')],
    run: async (ctx) => {
      const rows = await Sale.aggregate([
        { $match: saleMatch(ctx) }, { $unwind: '$payments' },
        { $group: { _id: '$payments.mode', bills: { $sum: 1 }, amount: { $sum: '$payments.amount' } } },
        { $project: { _id: 0, mode: { $toUpper: '$_id' }, bills: 1, amount: { $round: ['$amount', 2] } } }, { $sort: { amount: -1 } },
      ]);
      const total = rows.reduce((a, r) => a + r.amount, 0);
      rows.forEach((r) => { r.share = total ? round2((r.amount / total) * 100) : 0; });
      return paginateRows(rows, ctx, ['bills', 'amount']);
    },
  },
  sales_returns: {
    group: 'Sales', title: 'Sales Returns Register',
    columns: [C('date', 'Date', 'date'), C('returnNo', 'Return No'), C('type', 'Type'), C('invoiceNumber', 'Invoice'), C('customerName', 'Customer'), num('totalQty', 'Qty'), money('taxable', 'Taxable'), money('totalTax', 'GST'), money('amount', 'Value'), C('refundMode', 'Refund Mode'), C('createdByName', 'By')],
    run: (ctx) => {
      const m = { companyId: ctx.companyId, ...ctx.branch, createdAt: { $gte: ctx.from, $lte: ctx.to } };
      if (ctx.search) m.$or = [{ returnNo: new RegExp(escapeRegex(ctx.search), 'i') }, { invoiceNumber: new RegExp(escapeRegex(ctx.search), 'i') }];
      return facet(SaleReturn, [{ $match: m }, { $sort: { createdAt: -1 } }, { $project: { date: '$createdAt', returnNo: 1, type: 1, invoiceNumber: 1, customerName: 1, totalQty: 1, taxable: 1, totalTax: 1, amount: 1, refundMode: 1, createdByName: 1 } }], ctx, ['totalQty', 'taxable', 'totalTax', 'amount']);
    },
  },

  /* ---------------- INVENTORY ---------------- */
  stock_current: { group: 'Inventory', title: 'Current Stock', columns: stockCols(), run: (ctx) => stockRows(ctx, {}) },
  stock_low: { group: 'Inventory', title: 'Low Stock', columns: stockCols(), run: async (ctx) => stockRows(ctx, { low: true }) },
  stock_out: { group: 'Inventory', title: 'Out of Stock', columns: stockCols(), run: (ctx) => stockRows(ctx, { out: true }) },
  stock_valuation: {
    group: 'Inventory', title: 'Stock Valuation (by Category)',
    columns: [C('category', 'Category'), num('variants', 'Variants'), num('qty', 'Qty'), money('costValue', 'Cost Value'), money('mrpValue', 'MRP Value'), money('saleValue', 'Selling Value'), money('margin', 'Potential Margin')],
    run: (ctx) => facet(Stock, [
      { $match: { companyId: ctx.companyId, ...ctx.branch, current: { $gt: 0 } } },
      { $lookup: { from: 'productvariants', localField: 'variantId', foreignField: '_id', as: 'v' } }, { $unwind: '$v' },
      {
        $group: {
          _id: '$v.categoryId', category: { $first: '$v.categoryName' }, variants: { $addToSet: '$variantId' }, qty: { $sum: '$current' },
          costValue: { $sum: { $multiply: ['$current', { $cond: [{ $gt: ['$avgCost', 0] }, '$avgCost', '$v.purchasePrice'] }] } },
          mrpValue: { $sum: { $multiply: ['$current', '$v.mrp'] } }, saleValue: { $sum: { $multiply: ['$current', '$v.sellingPrice'] } },
        },
      },
      { $project: { _id: 0, category: 1, variants: { $size: '$variants' }, qty: 1, costValue: { $round: ['$costValue', 2] }, mrpValue: { $round: ['$mrpValue', 2] }, saleValue: { $round: ['$saleValue', 2] }, margin: { $round: [{ $subtract: ['$saleValue', '$costValue'] }, 2] } } },
      { $sort: { costValue: -1 } },
    ], ctx, ['variants', 'qty', 'costValue', 'mrpValue', 'saleValue', 'margin']),
  },
  stock_fast: {
    group: 'Inventory', title: 'Fast Moving Items',
    columns: [C('productName', 'Product'), C('sku', 'SKU'), C('size', 'Size'), C('color', 'Color'), num('qty', 'Qty Sold'), num('bills', 'Bills'), money('amount', 'Sales'), num('stock', 'Current Stock')],
    run: (ctx) => movers(ctx, -1),
  },
  stock_slow: {
    group: 'Inventory', title: 'Slow Moving Items',
    columns: [C('productName', 'Product'), C('sku', 'SKU'), C('size', 'Size'), C('color', 'Color'), num('qty', 'Qty Sold'), num('bills', 'Bills'), money('amount', 'Sales'), num('stock', 'Current Stock')],
    run: (ctx) => movers(ctx, 1),
  },
  stock_dead: {
    group: 'Inventory', title: 'Dead Stock',
    columns: [C('productName', 'Product'), C('sku', 'SKU'), C('size', 'Size'), C('color', 'Color'), C('branch', 'Branch'), num('current', 'Stock'), money('value', 'Value'), C('lastSoldAt', 'Last Sold', 'date'), num('days', 'Days Idle')],
    run: async (ctx) => {
      const settings = await settingsService.get(ctx.companyId);
      const days = Number(ctx.q.days || settings.stock.deadStockDays || 90);
      const cutoff = new Date(Date.now() - days * 86400000);
      const bn = await branchNames(ctx.companyId);
      const r = await facet(Stock, [
        { $match: { companyId: ctx.companyId, ...ctx.branch, current: { $gt: 0 }, $or: [{ lastSoldAt: { $lt: cutoff } }, { lastSoldAt: null, createdAt: { $lt: cutoff } }] } },
        { $lookup: { from: 'productvariants', localField: 'variantId', foreignField: '_id', as: 'v' } }, { $unwind: '$v' },
        { $project: { _id: 0, branchId: 1, productName: '$v.productName', sku: '$v.sku', size: '$v.size', color: '$v.color', current: 1, value: { $round: [{ $multiply: ['$current', { $cond: [{ $gt: ['$avgCost', 0] }, '$avgCost', '$v.purchasePrice'] }] }, 2] }, lastSoldAt: 1, days: { $round: [{ $divide: [{ $subtract: [new Date(), { $ifNull: ['$lastSoldAt', '$createdAt'] }] }, 86400000] }, 0] } } },
        { $sort: { days: -1 } },
      ], ctx, ['current', 'value']);
      r.rows = r.rows.map((x) => ({ ...x, branch: bn.get(String(x.branchId)) }));
      return r;
    },
  },
  stock_transfer: {
    group: 'Inventory', title: 'Stock Transfer Report',
    columns: [C('date', 'Date', 'date'), C('transferNo', 'Transfer No'), C('from', 'From'), C('to', 'To'), C('status', 'Status'), C('productName', 'Product'), C('sku', 'SKU'), C('size', 'Size'), C('color', 'Color'), num('qty', 'Sent'), num('receivedQty', 'Received'), money('value', 'Value')],
    run: async (ctx) => {
      const bn = await branchNames(ctx.companyId);
      const tm = { 't.companyId': ctx.companyId, 't.createdAt': { $gte: ctx.from, $lte: ctx.to } };
      if (ctx.branch.branchId) tm.$or = [{ 't.fromBranchId': ctx.branch.branchId }, { 't.toBranchId': ctx.branch.branchId }];
      const r = await facet(StockTransferItem, [
        { $match: { companyId: ctx.companyId } },
        { $lookup: { from: 'stocktransfers', localField: 'transferId', foreignField: '_id', as: 't' } }, { $unwind: '$t' },
        { $match: tm }, ...itemSearch(ctx), { $sort: { 't.createdAt': -1 } },
        { $project: { _id: 0, date: '$t.createdAt', transferNo: '$t.transferNo', fromId: '$t.fromBranchId', toId: '$t.toBranchId', status: '$t.status', productName: 1, sku: 1, size: 1, color: 1, qty: 1, receivedQty: 1, value: { $round: [{ $multiply: ['$qty', '$costPrice'] }, 2] } } },
      ], ctx, ['qty', 'receivedQty', 'value']);
      r.rows = r.rows.map((x) => ({ ...x, from: bn.get(String(x.fromId)), to: bn.get(String(x.toId)) }));
      return r;
    },
  },
  stock_adjustment: {
    group: 'Inventory', title: 'Stock Adjustment Report',
    columns: [C('date', 'Date', 'date'), C('adjustmentNo', 'Adj No'), C('branch', 'Branch'), C('type', 'Type'), C('productName', 'Product'), C('sku', 'SKU'), C('size', 'Size'), C('color', 'Color'), num('beforeQty', 'Before'), num('qty', 'Change'), num('afterQty', 'After'), money('value', 'Value'), C('reason', 'Reason'), C('userName', 'By')],
    run: async (ctx) => {
      const bn = await branchNames(ctx.companyId);
      const r = await facet(StockAdjustment, [
        { $match: { companyId: ctx.companyId, ...ctx.branch, createdAt: { $gte: ctx.from, $lte: ctx.to }, ...(ctx.q.type ? { type: ctx.q.type } : {}) } },
        { $unwind: '$items' }, { $sort: { createdAt: -1 } },
        { $project: { _id: 0, date: '$createdAt', adjustmentNo: 1, branchId: 1, type: 1, reason: 1, userName: 1, productName: '$items.productName', sku: '$items.sku', size: '$items.size', color: '$items.color', beforeQty: '$items.beforeQty', qty: '$items.qty', afterQty: '$items.afterQty', value: { $round: [{ $multiply: ['$items.qty', { $ifNull: ['$items.costPrice', 0] }] }, 2] } } },
      ], ctx, ['qty', 'value']);
      r.rows = r.rows.map((x) => ({ ...x, branch: bn.get(String(x.branchId)) }));
      return r;
    },
  },

  /* ---------------- PURCHASE ---------------- */
  purchase_supplier: {
    group: 'Purchase', title: 'Supplier-wise Purchase',
    columns: [C('supplier', 'Supplier'), num('invoices', 'Invoices'), num('qty', 'Qty'), money('taxable', 'Taxable'), money('tax', 'GST'), money('total', 'Total'), money('paid', 'Paid'), money('returned', 'Returned'), money('due', 'Due')],
    run: (ctx) => facet(Purchase, [
      { $match: { companyId: ctx.companyId, ...ctx.branch, status: 'received', invoiceDate: { $gte: ctx.from, $lte: ctx.to } } },
      { $group: { _id: '$supplierId', supplier: { $first: '$supplierName' }, invoices: { $sum: 1 }, qty: { $sum: '$totals.totalQty' }, taxable: { $sum: '$totals.taxable' }, tax: { $sum: '$totals.totalTax' }, total: { $sum: '$totals.grandTotal' }, paid: { $sum: '$paidAmount' }, returned: { $sum: '$returnedAmount' }, due: { $sum: '$dueAmount' } } },
      { $project: { _id: 0, supplier: 1, invoices: 1, qty: 1, taxable: { $round: ['$taxable', 2] }, tax: { $round: ['$tax', 2] }, total: { $round: ['$total', 2] }, paid: { $round: ['$paid', 2] }, returned: { $round: ['$returned', 2] }, due: { $round: ['$due', 2] } } },
      { $sort: { total: -1 } },
    ], ctx, ['invoices', 'qty', 'taxable', 'tax', 'total', 'paid', 'returned', 'due']),
  },
  purchase_product: {
    group: 'Purchase', title: 'Product-wise Purchase',
    columns: [C('productName', 'Product'), C('sku', 'SKU'), C('size', 'Size'), C('color', 'Color'), num('qty', 'Qty'), num('returnedQty', 'Returned'), money('avgRate', 'Avg Rate'), money('taxable', 'Taxable'), money('tax', 'GST'), money('amount', 'Amount')],
    run: (ctx) => facet(PurchaseItem, [
      { $match: { companyId: ctx.companyId, ...ctx.branch, status: 'received', invoiceDate: { $gte: ctx.from, $lte: ctx.to } } }, ...itemSearch(ctx),
      { $group: { _id: '$variantId', productName: { $first: '$productName' }, sku: { $first: '$sku' }, size: { $first: '$size' }, color: { $first: '$color' }, qty: { $sum: '$qty' }, returnedQty: { $sum: '$returnedQty' }, taxable: { $sum: '$taxable' }, tax: { $sum: '$taxAmount' }, amount: { $sum: '$amount' } } },
      { $project: { _id: 0, productName: 1, sku: 1, size: 1, color: 1, qty: 1, returnedQty: 1, avgRate: { $round: [{ $divide: ['$taxable', '$qty'] }, 2] }, taxable: { $round: ['$taxable', 2] }, tax: { $round: ['$tax', 2] }, amount: { $round: ['$amount', 2] } } },
      { $sort: { amount: -1 } },
    ], ctx, ['qty', 'returnedQty', 'taxable', 'tax', 'amount']),
  },
  purchase_datewise: {
    group: 'Purchase', title: 'Date-wise Purchase Register',
    columns: [C('invoiceDate', 'Invoice Date', 'date'), C('purchaseNo', 'Purchase No'), C('invoiceNumber', 'Supplier Inv'), C('supplierName', 'Supplier'), C('status', 'Status'), num('qty', 'Qty'), money('taxable', 'Taxable'), money('tax', 'GST'), money('total', 'Total'), money('paidAmount', 'Paid'), money('dueAmount', 'Due')],
    run: (ctx) => {
      const m = { companyId: ctx.companyId, ...ctx.branch, invoiceDate: { $gte: ctx.from, $lte: ctx.to } };
      if (ctx.search) m.$or = [{ purchaseNo: new RegExp(escapeRegex(ctx.search), 'i') }, { invoiceNumber: new RegExp(escapeRegex(ctx.search), 'i') }, { supplierName: new RegExp(escapeRegex(ctx.search), 'i') }];
      return facet(Purchase, [{ $match: m }, { $sort: { invoiceDate: -1 } }, { $project: { invoiceDate: 1, purchaseNo: 1, invoiceNumber: 1, supplierName: 1, status: 1, qty: '$totals.totalQty', taxable: '$totals.taxable', tax: '$totals.totalTax', total: '$totals.grandTotal', paidAmount: 1, dueAmount: 1 } }], ctx, ['qty', 'taxable', 'tax', 'total', 'paidAmount', 'dueAmount']);
    },
  },
  purchase_returns: {
    group: 'Purchase', title: 'Purchase Returns',
    columns: [C('date', 'Date', 'date'), C('returnNo', 'Return No'), C('purchaseNo', 'Purchase No'), C('supplierName', 'Supplier'), num('totalQty', 'Qty'), money('taxable', 'Taxable'), money('totalTax', 'GST'), money('amount', 'Amount'), C('settlement', 'Settlement')],
    run: (ctx) => facet(PurchaseReturn, [{ $match: { companyId: ctx.companyId, ...ctx.branch, createdAt: { $gte: ctx.from, $lte: ctx.to } } }, { $sort: { createdAt: -1 } }, { $project: { date: '$createdAt', returnNo: 1, purchaseNo: 1, supplierName: 1, totalQty: 1, taxable: 1, totalTax: 1, amount: 1, settlement: 1 } }], ctx, ['totalQty', 'taxable', 'totalTax', 'amount']),
  },

  /* ---------------- CUSTOMERS ---------------- */
  customer_purchase: {
    group: 'Customers', title: 'Customer Purchases',
    columns: [C('name', 'Customer'), C('mobile', 'Mobile'), num('bills', 'Bills'), num('qty', 'Items'), money('total', 'Purchases'), money('avgBill', 'Avg Bill'), C('lastPurchase', 'Last Purchase', 'date')],
    run: (ctx) => facet(Sale, [
      { $match: saleMatch(ctx, { customerId: { $ne: null } }) },
      { $group: { _id: '$customerId', name: { $first: '$customer.name' }, mobile: { $first: '$customer.mobile' }, bills: { $sum: 1 }, qty: { $sum: '$totals.totalQty' }, total: { $sum: '$totals.grandTotal' }, lastPurchase: { $max: '$createdAt' } } },
      ...(ctx.search ? [{ $match: { $or: [{ name: new RegExp(escapeRegex(ctx.search), 'i') }, { mobile: new RegExp(escapeRegex(ctx.search)) }] } }] : []),
      { $project: { _id: 0, name: 1, mobile: 1, bills: 1, qty: 1, total: { $round: ['$total', 2] }, avgBill: { $round: [{ $divide: ['$total', '$bills'] }, 2] }, lastPurchase: 1 } },
      { $sort: { total: -1 } },
    ], ctx, ['bills', 'qty', 'total']),
  },
  customer_returns: {
    group: 'Customers', title: 'Customer Returns',
    columns: [C('name', 'Customer'), num('returns', 'Returns'), num('qty', 'Qty'), money('amount', 'Value')],
    run: (ctx) => facet(SaleReturn, [
      { $match: { companyId: ctx.companyId, ...ctx.branch, createdAt: { $gte: ctx.from, $lte: ctx.to }, customerId: { $ne: null } } },
      { $group: { _id: '$customerId', name: { $first: '$customerName' }, returns: { $sum: 1 }, qty: { $sum: '$totalQty' }, amount: { $sum: '$amount' } } },
      { $project: { _id: 0, name: 1, returns: 1, qty: 1, amount: { $round: ['$amount', 2] } } }, { $sort: { amount: -1 } },
    ], ctx, ['returns', 'qty', 'amount']),
  },
  customer_outstanding: {
    group: 'Customers', title: 'Customer Outstanding',
    columns: [C('code', 'Code'), C('name', 'Customer'), C('mobile', 'Mobile'), money('outstanding', 'Outstanding'), money('storeCredit', 'Store Credit'), money('totalPurchases', 'Total Purchases'), C('lastPurchaseAt', 'Last Purchase', 'date')],
    run: (ctx) => facet(Customer, [
      { $match: { companyId: ctx.companyId, $or: [{ outstanding: { $gt: 0 } }, { storeCredit: { $gt: 0 } }], ...(ctx.search ? { name: new RegExp(escapeRegex(ctx.search), 'i') } : {}) } },
      { $sort: { outstanding: -1 } }, { $project: { _id: 0, code: 1, name: 1, mobile: 1, outstanding: 1, storeCredit: 1, totalPurchases: 1, lastPurchaseAt: 1 } },
    ], ctx, ['outstanding', 'storeCredit', 'totalPurchases']),
  },
  customer_loyalty: {
    group: 'Customers', title: 'Loyalty Points',
    columns: [C('code', 'Code'), C('name', 'Customer'), C('mobile', 'Mobile'), num('loyaltyPoints', 'Points'), money('totalPurchases', 'Total Purchases'), num('totalBills', 'Bills')],
    run: (ctx) => facet(Customer, [
      { $match: { companyId: ctx.companyId, loyaltyPoints: { $gt: 0 }, ...(ctx.search ? { name: new RegExp(escapeRegex(ctx.search), 'i') } : {}) } },
      { $sort: { loyaltyPoints: -1 } }, { $project: { _id: 0, code: 1, name: 1, mobile: 1, loyaltyPoints: 1, totalPurchases: 1, totalBills: 1 } },
    ], ctx, ['loyaltyPoints', 'totalPurchases', 'totalBills']),
  },

  /* ---------------- FINANCIAL ---------------- */
  fin_sales: {
    group: 'Financial', financial: true, title: 'Sales Summary',
    // each day: its bill numbers (first – last) and how it was paid (Cash / GPay / Card / Others)
    columns: [C('period', 'Date'), C('billNos', 'Bill No'), ...periodCols('Date').slice(1, 8), money('cash', 'Cash'), money('upi', 'GPay'), money('card', 'Card'), money('other', 'Others'), ...periodCols('Date').slice(8)],
    run: (ctx) => salesByPeriod(ctx, dayKey),
  },
  fin_purchase: {
    group: 'Financial', financial: true, title: 'Purchase Summary',
    columns: [C('period', 'Date'), num('invoices', 'Invoices'), money('taxable', 'Taxable'), money('tax', 'Input GST'), money('total', 'Total')],
    run: (ctx) => facet(Purchase, [
      { $match: { companyId: ctx.companyId, ...ctx.branch, status: 'received', invoiceDate: { $gte: ctx.from, $lte: ctx.to } } },
      { $group: { _id: dayKey('$invoiceDate'), invoices: { $sum: 1 }, taxable: { $sum: '$totals.taxable' }, tax: { $sum: '$totals.totalTax' }, total: { $sum: '$totals.grandTotal' } } },
      { $project: { _id: 0, period: '$_id', invoices: 1, taxable: { $round: ['$taxable', 2] }, tax: { $round: ['$tax', 2] }, total: { $round: ['$total', 2] } } }, { $sort: { period: -1 } },
    ], ctx, ['invoices', 'taxable', 'tax', 'total']),
  },
  fin_expenses: {
    group: 'Financial', financial: true, title: 'Expense Report',
    columns: [C('category', 'Category'), num('entries', 'Entries'), money('cash', 'Cash'), money('bank', 'Bank/UPI/Card'), money('amount', 'Total')],
    run: (ctx) => facet(Expense, [
      { $match: { companyId: ctx.companyId, ...ctx.branch, status: 'active', date: { $gte: ctx.from, $lte: ctx.to } } },
      { $group: { _id: '$categoryId', category: { $first: '$categoryName' }, entries: { $sum: 1 }, cash: { $sum: { $cond: [{ $eq: ['$paymentMode', 'cash'] }, '$amount', 0] } }, bank: { $sum: { $cond: [{ $ne: ['$paymentMode', 'cash'] }, '$amount', 0] } }, amount: { $sum: '$amount' } } },
      { $project: { _id: 0, category: 1, entries: 1, cash: { $round: ['$cash', 2] }, bank: { $round: ['$bank', 2] }, amount: { $round: ['$amount', 2] } } }, { $sort: { amount: -1 } },
    ], ctx, ['entries', 'cash', 'bank', 'amount']),
  },
  profit_loss: {
    group: 'Financial', financial: true, title: 'Profit & Loss',
    columns: [C('head', 'Particulars'), money('amount', 'Amount (₹)')],
    run: async (ctx) => {
      const sm = saleMatch(ctx);
      const rm = { companyId: ctx.companyId, ...ctx.branch, createdAt: { $gte: ctx.from, $lte: ctx.to } };
      const [s] = await Sale.aggregate([{ $match: sm }, { $group: { _id: null, taxable: { $sum: '$totals.taxable' }, tax: { $sum: '$totals.totalTax' }, total: { $sum: '$totals.grandTotal' }, cost: { $sum: '$costTotal' }, discount: { $sum: '$totals.discount' }, roundOff: { $sum: '$totals.roundOff' } } }]);
      const [r] = await SaleReturn.aggregate([{ $match: rm }, { $group: { _id: null, taxable: { $sum: '$taxable' }, cost: { $sum: '$costTotal' } } }]);
      const [e] = await Expense.aggregate([{ $match: { companyId: ctx.companyId, ...ctx.branch, status: 'active', date: { $gte: ctx.from, $lte: ctx.to } } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]);
      const expByCat = await Expense.aggregate([{ $match: { companyId: ctx.companyId, ...ctx.branch, status: 'active', date: { $gte: ctx.from, $lte: ctx.to } } }, { $group: { _id: '$categoryName', amount: { $sum: '$amount' } } }, { $sort: { amount: -1 } }]);
      const sales = round2(s?.taxable || 0);
      const returns = round2(r?.taxable || 0);
      const netSales = round2(sales - returns);
      const cogs = round2((s?.cost || 0) - (r?.cost || 0));
      const gross = round2(netSales - cogs);
      const expenses = round2(e?.amount || 0);
      const roundOff = round2(s?.roundOff || 0);
      const net = round2(gross - expenses + roundOff);
      const rows = [
        { head: 'Sales (taxable value, excl. GST)', amount: sales },
        { head: 'Less: Sales Returns', amount: -returns },
        { head: 'Net Sales', amount: netSales, bold: true },
        { head: 'Less: Cost of Goods Sold', amount: -cogs },
        { head: 'Gross Profit', amount: gross, bold: true },
        { head: `Gross Margin %`, amount: netSales ? round2((gross / netSales) * 100) : 0, isPercent: true },
        ...expByCat.map((x) => ({ head: `Less: Expense - ${x._id}`, amount: -round2(x.amount) })),
        { head: 'Total Expenses', amount: -expenses, bold: true },
        { head: 'Round-off on bills', amount: roundOff },
        { head: 'Net Profit / (Loss)', amount: net, bold: true },
        { head: 'Memo: Discounts given', amount: round2(s?.discount || 0), memo: true },
        { head: 'Memo: Output GST collected', amount: round2(s?.tax || 0), memo: true },
      ];
      return { rows, totals: {}, total: rows.length, page: 1, pages: 1 };
    },
  },
  cash_book: {
    group: 'Financial', financial: true, title: 'Cash Book',
    columns: [C('date', 'Date', 'date'), C('refNo', 'Ref No'), C('particulars', 'Particulars'), C('user', 'By'), money('receipt', 'Receipt'), money('payment', 'Payment'), money('balance', 'Balance')],
    run: async (ctx) => {
      const mode = ctx.q.mode || 'cash';
      const pm = { companyId: ctx.companyId, ...ctx.branch, mode, date: { $gte: ctx.from, $lte: ctx.to } };
      const em = { companyId: ctx.companyId, ...ctx.branch, status: 'active', paymentMode: mode, date: { $gte: ctx.from, $lte: ctx.to } };
      const [pays, exps] = await Promise.all([
        Payment.find(pm).sort({ date: 1 }).limit(20000).lean(),
        mode === 'card' || mode === 'upi' || mode === 'bank' || mode === 'cash' ? Expense.find(em).sort({ date: 1 }).limit(20000).lean() : [],
      ]);
      const LABEL = { sale: 'Sales', sale_refund: 'Sales refund', sale_cancel: 'Bill cancelled', customer_receipt: 'Received from', supplier_payment: 'Paid to supplier', supplier_refund: 'Supplier refund' };
      const entries = [
        ...pays.map((p) => ({ date: p.date, refNo: p.refNo || p.paymentNo, particulars: `${LABEL[p.type] || p.type}${p.partyName ? ` - ${p.partyName}` : ''}`, user: p.userName, receipt: p.direction === 'in' ? p.amount : 0, payment: p.direction === 'out' ? p.amount : 0 })),
        ...exps.map((x) => ({ date: x.date, refNo: x.expenseNo, particulars: `Expense - ${x.categoryName}${x.paidTo ? ` (${x.paidTo})` : ''}`, user: x.userName, receipt: 0, payment: x.amount })),
      ].sort((a, b) => new Date(a.date) - new Date(b.date));
      let bal = 0;
      entries.forEach((e) => { bal = round2(bal + e.receipt - e.payment); e.balance = bal; });
      return paginateRows(entries, ctx, ['receipt', 'payment']);
    },
  },
  payment_summary: {
    group: 'Financial', financial: true, title: 'Payment Summary',
    columns: [C('mode', 'Mode'), money('sales', 'Sales Receipts'), money('receipts', 'Customer Receipts'), money('refunds', 'Refunds'), money('supplier', 'Supplier Payments'), money('net', 'Net')],
    run: async (ctx) => {
      const rows = await Payment.aggregate([
        { $match: { companyId: ctx.companyId, ...ctx.branch, date: { $gte: ctx.from, $lte: ctx.to } } },
        {
          $group: {
            _id: '$mode',
            sales: { $sum: { $cond: [{ $eq: ['$type', 'sale'] }, '$amount', 0] } },
            receipts: { $sum: { $cond: [{ $in: ['$type', ['customer_receipt', 'supplier_refund']] }, '$amount', 0] } },
            refunds: { $sum: { $cond: [{ $in: ['$type', ['sale_refund', 'sale_cancel']] }, '$amount', 0] } },
            supplier: { $sum: { $cond: [{ $eq: ['$type', 'supplier_payment'] }, '$amount', 0] } },
            net: { $sum: { $cond: [{ $eq: ['$direction', 'in'] }, '$amount', { $multiply: ['$amount', -1] }] } },
          },
        },
        { $project: { _id: 0, mode: { $toUpper: '$_id' }, sales: { $round: ['$sales', 2] }, receipts: { $round: ['$receipts', 2] }, refunds: { $round: ['$refunds', 2] }, supplier: { $round: ['$supplier', 2] }, net: { $round: ['$net', 2] } } },
        { $sort: { net: -1 } },
      ]);
      return paginateRows(rows, ctx, ['sales', 'receipts', 'refunds', 'supplier', 'net']);
    },
  },
  gst_billing: {
    group: 'Financial', financial: true, title: 'GST Billing (GPay / Card bills)',
    columns: [C('date', 'Date', 'date'), C('invoiceNumber', 'Invoice'), C('customer', 'Customer'), C('gstin', 'Customer GSTIN'), C('mode', 'Paid by'), money('upi', 'GPay / UPI'), money('card', 'Card'), money('taxable', 'Taxable'), money('cgst', 'CGST'), money('sgst', 'SGST'), money('igst', 'IGST'), money('tax', 'Total GST'), money('total', 'Bill Total')],
    // bills paid (fully or partly) by GPay / UPI or card; ?mode=upi or card narrows it to one
    run: async (ctx) => {
      const modes = ctx.q.mode === 'upi' || ctx.q.mode === 'card' ? [ctx.q.mode] : ['upi', 'card'];
      const m = saleMatch(ctx, { 'payments.mode': { $in: modes } });
      if (ctx.search) m.$or = [{ invoiceNumber: new RegExp(escapeRegex(ctx.search), 'i') }, { 'customer.name': new RegExp(escapeRegex(ctx.search), 'i') }, { 'customer.mobile': new RegExp(escapeRegex(ctx.search)) }];
      const sales = await Sale.find(m).sort({ createdAt: 1 }).select('createdAt invoiceNumber customer payments totals').lean();
      const paid = (s, mode) => round2((s.payments || []).filter((p) => p.mode === mode).reduce((a, p) => a + p.amount, 0));
      const rows = sales.map((s) => ({
        date: s.createdAt, invoiceNumber: s.invoiceNumber, customer: s.customer?.name || 'Walk-in', gstin: s.customer?.gstNumber || '',
        mode: [...new Set((s.payments || []).map((p) => modeName(p.mode)))].join(' + '), upi: paid(s, 'upi'), card: paid(s, 'card'),
        taxable: round2(s.totals.taxable), cgst: round2(s.totals.cgst), sgst: round2(s.totals.sgst), igst: round2(s.totals.igst), tax: round2(s.totals.totalTax), total: round2(s.totals.grandTotal),
      }));
      return paginateRows(rows, ctx, ['upi', 'card', 'taxable', 'cgst', 'sgst', 'igst', 'tax', 'total']);
    },
  },
  gst_taxwise: {
    group: 'Financial', financial: true, title: 'GST Report (Tax-wise)',
    columns: [C('label', 'GST Rate / Invoice'), C('date', 'Date', 'date'), num('bills', 'Bills'), num('qty', 'Qty'), money('taxable', 'Taxable Value'), C('cgstRate', 'CGST %'), money('cgst', 'CGST'), C('sgstRate', 'SGST %'), money('sgst', 'SGST'), money('igst', 'IGST'), money('tax', 'Total GST'), money('value', 'Invoice Value')],
    // every GST rate on its own: ?view=bills lists the invoices under each rate; ?mode= limits to bills paid that way
    run: async (ctx) => {
      const saleIds = await salesPaidBy(ctx);
      const im = { ...saleMatch(ctx), ...(saleIds ? { saleId: { $in: saleIds } } : {}) };
      const sums = { qty: { $sum: '$qty' }, taxable: { $sum: '$taxable' }, cgst: { $sum: '$cgst' }, sgst: { $sum: '$sgst' }, igst: { $sum: '$igst' }, tax: { $sum: '$taxAmount' }, value: { $sum: '$amount' } };
      const retMatch = { companyId: ctx.companyId, ...ctx.branch, createdAt: { $gte: ctx.from, $lte: ctx.to }, ...(saleIds ? { saleId: { $in: saleIds } } : {}) };
      const [byRate, rets] = await Promise.all([
        SaleItem.aggregate([{ $match: im }, { $group: { _id: '$gstRate', bills: { $addToSet: '$saleId' }, ...sums } }, { $sort: { _id: 1 } }]),
        // returns done on the Sales Return page (credit notes) reduce the rate they were billed at
        SaleReturn.aggregate([{ $match: retMatch }, { $unwind: '$items' }, { $replaceRoot: { newRoot: '$items' } }, { $group: { _id: '$gstRate', ...sums } }]),
      ]);
      const rm = new Map(rets.map((r) => [r._id, r]));
      const rateRow = (r, s, label, extra = {}) => {
        const ret = rm.get(r) || {};
        const v = (k) => round2((s[k] || 0) - (ret[k] || 0));
        return { label, gstRate: r, cgstRate: r ? `${r / 2}%` : '0%', sgstRate: r ? `${r / 2}%` : '0%', qty: v('qty'), taxable: v('taxable'), cgst: v('cgst'), sgst: v('sgst'), igst: v('igst'), tax: v('tax'), value: v('value'), ...extra };
      };
      const rates = [...new Set([...byRate.map((x) => x._id), ...rets.map((x) => x._id)])].sort((a, b) => a - b);
      let rows;
      if (ctx.q.view === 'bills') {
        const bills = await SaleItem.aggregate([
          { $match: im },
          { $group: { _id: { r: '$gstRate', s: '$saleId' }, invoiceNumber: { $first: '$invoiceNumber' }, date: { $min: '$createdAt' }, ...sums } },
          { $sort: { '_id.r': 1, date: 1 } },
        ]).allowDiskUse(true);
        rows = [];
        rates.forEach((r) => {
          const s = byRate.find((x) => x._id === r) || {};
          rows.push(rateRow(r, s, `GST ${r}%  (total)`, { bills: (s.bills || []).length, bold: true }));
          bills.filter((b) => b._id.r === r).forEach((b) => rows.push({
            label: `   ${b.invoiceNumber}`, date: b.date, cgstRate: r ? `${r / 2}%` : '0%', sgstRate: r ? `${r / 2}%` : '0%', bills: 1, qty: b.qty,
            taxable: round2(b.taxable), cgst: round2(b.cgst), sgst: round2(b.sgst), igst: round2(b.igst), tax: round2(b.tax), value: round2(b.value),
          }));
          if (rm.get(r)) rows.push({ label: `   Less: returns at ${r}%`, qty: -rm.get(r).qty, taxable: -round2(rm.get(r).taxable), cgst: -round2(rm.get(r).cgst), sgst: -round2(rm.get(r).sgst), igst: -round2(rm.get(r).igst), tax: -round2(rm.get(r).tax), value: -round2(rm.get(r).value), memo: true });
        });
        const res = paginateRows(rows, ctx, []);
        res.totals = gstTotals(rates.map((r) => { const s = byRate.find((x) => x._id === r) || {}; return rateRow(r, s, '', { bills: (s.bills || []).length }); }));
        return res;
      }
      rows = rates.map((r) => { const s = byRate.find((x) => x._id === r) || {}; return rateRow(r, s, `GST ${r}%`, { bills: (s.bills || []).length }); });
      const res = paginateRows(rows, ctx, []);
      res.totals = gstTotals(rows);
      return res;
    },
  },
  sales_summary_product: {
    group: 'Financial', financial: true, title: 'Sales Summary (Product-wise)',
    columns: [C('productName', 'Product'), C('sku', 'SKU'), C('size', 'Size'), C('color', 'Color'), num('qty', 'Qty Sold'), num('returned', 'Returned'), num('netQty', 'Net Qty'),
      money('sales', 'Sales Amount'), money('cost', 'Purchase Cost'), money('profit', 'Profit'), C('margin', 'Profit %', 'percent'),
      money('cash', 'Cash'), money('upi', 'GPay / UPI'), money('card', 'Card'), money('other', 'Credit / Other'), num('stock', 'In Stock'),
      C('lastPurchase', 'Last Purchased', 'date'), money('purchaseRate', 'Purchase Rate'), C('supplier', 'Supplier'), C('purchaseNo', 'Purchase No')],
    // per product: what sold, profit (taxable value − purchase cost), how it was paid, stock and the last purchase; ?mode= bills paid that way
    run: async (ctx) => {
      const sales = await Sale.find(saleMatch(ctx, modeMatch(ctx))).select('_id payments').lean();
      const share = new Map(sales.map((s) => {
        const pos = (s.payments || []).reduce((a, p) => a + Math.abs(p.amount), 0) || 1;
        const f = { cash: 0, upi: 0, card: 0, other: 0 };
        (s.payments || []).forEach((p) => { f[['cash', 'upi', 'card'].includes(p.mode) ? p.mode : 'other'] += Math.abs(p.amount) / pos; });
        return [String(s._id), f];
      }));
      const im = { ...saleMatch(ctx), saleId: { $in: sales.map((s) => s._id) } };
      if (ctx.search) im.$or = [{ productName: new RegExp(escapeRegex(ctx.search), 'i') }, { sku: ctx.search.toUpperCase() }, { barcode: ctx.search }];
      const items = await SaleItem.find(im).select('saleId variantId productName sku size color qty returnedQty amount taxable costPrice').lean();
      const by = new Map();
      for (const it of items) {
        const k = String(it.variantId);
        const g = by.get(k) || { variantId: it.variantId, productName: it.productName, sku: it.sku, size: it.size, color: it.color, qty: 0, returned: 0, sales: 0, taxable: 0, cost: 0, cash: 0, upi: 0, card: 0, other: 0 };
        const returned = it.qty > 0 ? Math.min(it.returnedQty || 0, it.qty) : -it.qty; // minus lines = returned at the counter
        const keep = it.qty > 0 ? (it.qty - returned) / it.qty : 1;
        const amt = it.amount * keep;
        if (it.qty > 0) g.qty += it.qty;
        g.returned += returned;
        g.sales += amt;
        g.taxable += it.taxable * keep;
        g.cost += (it.costPrice || 0) * (it.qty > 0 ? it.qty - returned : it.qty);
        const f = share.get(String(it.saleId)) || { other: 1 };
        ['cash', 'upi', 'card', 'other'].forEach((m) => { g[m] += amt * (f[m] || 0); });
        by.set(k, g);
      }
      const ids = [...by.values()].map((g) => g.variantId);
      const [stock, lastBuy] = await Promise.all([
        Stock.aggregate([{ $match: { companyId: ctx.companyId, ...ctx.branch, variantId: { $in: ids } } }, { $group: { _id: '$variantId', current: { $sum: '$current' } } }]),
        PurchaseItem.aggregate([
          { $match: { companyId: ctx.companyId, ...ctx.branch, variantId: { $in: ids }, status: 'received' } },
          { $sort: { invoiceDate: -1, createdAt: -1 } },
          { $group: { _id: '$variantId', date: { $first: '$invoiceDate' }, rate: { $first: '$rate' }, purchaseId: { $first: '$purchaseId' } } },
          { $lookup: { from: 'purchases', localField: 'purchaseId', foreignField: '_id', as: 'p' } },
          { $project: { date: 1, rate: 1, supplier: { $first: '$p.supplierName' }, purchaseNo: { $first: '$p.purchaseNo' } } },
        ]),
      ]);
      const sm = new Map(stock.map((s) => [String(s._id), s.current]));
      const pm = new Map(lastBuy.map((p) => [String(p._id), p]));
      const rows = [...by.values()].map((g) => {
        const p = pm.get(String(g.variantId)) || {};
        const profit = round2(g.taxable - g.cost);
        return {
          variantId: g.variantId, productName: g.productName, sku: g.sku, size: g.size, color: g.color, qty: g.qty, returned: g.returned, netQty: g.qty - g.returned,
          sales: round2(g.sales), cost: round2(g.cost), profit, margin: g.taxable ? round2((profit / g.taxable) * 100) : 0,
          cash: round2(g.cash), upi: round2(g.upi), card: round2(g.card), other: round2(g.other), stock: sm.get(String(g.variantId)) ?? 0,
          lastPurchase: p.date, purchaseRate: p.rate, supplier: p.supplier || '', purchaseNo: p.purchaseNo || '',
        };
      }).sort((a, b) => b.sales - a.sales);
      const res = paginateRows(rows, ctx, ['qty', 'returned', 'netQty', 'sales', 'cost', 'profit', 'cash', 'upi', 'card', 'other', 'stock']);
      const tTaxable = [...by.values()].reduce((a, g) => a + g.taxable, 0);
      res.totals.margin = tTaxable ? round2((res.totals.profit / tTaxable) * 100) : 0;
      return res;
    },
  },
  gst_report: {
    group: 'Financial', financial: true, title: 'GST Report (Rate-wise)',
    columns: [C('section', 'Section'), C('gstRate', 'GST %'), money('taxable', 'Taxable'), money('cgst', 'CGST'), money('sgst', 'SGST'), money('igst', 'IGST'), money('tax', 'Total GST'), money('value', 'Invoice Value')],
    run: async (ctx) => {
      const grp = { _id: '$gstRate', taxable: { $sum: '$taxable' }, cgst: { $sum: '$cgst' }, sgst: { $sum: '$sgst' }, igst: { $sum: '$igst' }, tax: { $sum: '$taxAmount' }, value: { $sum: '$amount' } };
      const [out, ret, inp] = await Promise.all([
        SaleItem.aggregate([{ $match: saleMatch(ctx) }, { $group: grp }, { $sort: { _id: 1 } }]),
        SaleReturn.aggregate([{ $match: { companyId: ctx.companyId, ...ctx.branch, createdAt: { $gte: ctx.from, $lte: ctx.to } } }, { $unwind: '$items' }, { $replaceRoot: { newRoot: '$items' } }, { $group: grp }, { $sort: { _id: 1 } }]),
        PurchaseItem.aggregate([{ $match: { companyId: ctx.companyId, ...ctx.branch, status: 'received', invoiceDate: { $gte: ctx.from, $lte: ctx.to } } }, { $group: grp }, { $sort: { _id: 1 } }]),
      ]);
      const fmt = (section, sign) => (r) => ({ section, gstRate: `${r._id}%`, taxable: round2(sign * r.taxable), cgst: round2(sign * r.cgst), sgst: round2(sign * r.sgst), igst: round2(sign * r.igst), tax: round2(sign * r.tax), value: round2(sign * r.value) });
      const sum = (arr, k) => round2(arr.reduce((a, r) => a + r[k], 0));
      const o = out.map(fmt('Outward supplies (Sales)', 1));
      const r = ret.map(fmt('Less: Sales returns (Credit notes)', -1));
      const i = inp.map(fmt('Inward supplies (Purchases - ITC)', 1));
      const netOut = { section: 'NET OUTPUT TAX', gstRate: '', taxable: round2(sum(o, 'taxable') + sum(r, 'taxable')), cgst: round2(sum(o, 'cgst') + sum(r, 'cgst')), sgst: round2(sum(o, 'sgst') + sum(r, 'sgst')), igst: round2(sum(o, 'igst') + sum(r, 'igst')), tax: round2(sum(o, 'tax') + sum(r, 'tax')), value: round2(sum(o, 'value') + sum(r, 'value')), bold: true };
      const itc = { section: 'INPUT TAX CREDIT', gstRate: '', taxable: sum(i, 'taxable'), cgst: sum(i, 'cgst'), sgst: sum(i, 'sgst'), igst: sum(i, 'igst'), tax: sum(i, 'tax'), value: sum(i, 'value'), bold: true };
      const payable = { section: 'NET GST PAYABLE', gstRate: '', taxable: 0, cgst: round2(netOut.cgst - itc.cgst), sgst: round2(netOut.sgst - itc.sgst), igst: round2(netOut.igst - itc.igst), tax: round2(netOut.tax - itc.tax), value: 0, bold: true };
      const rows = [...o, ...r, netOut, ...i, itc, payable];
      return { rows, totals: {}, total: rows.length, page: 1, pages: 1 };
    },
  },
  gst_hsn: {
    group: 'Financial', financial: true, title: 'GST HSN Summary (Sales)',
    columns: [C('hsnCode', 'HSN'), C('gstRate', 'GST %'), num('qty', 'Qty'), money('taxable', 'Taxable'), money('cgst', 'CGST'), money('sgst', 'SGST'), money('igst', 'IGST'), money('value', 'Value')],
    run: (ctx) => facet(SaleItem, [
      { $match: saleMatch(ctx) },
      { $group: { _id: { h: '$hsnCode', r: '$gstRate' }, qty: { $sum: '$qty' }, taxable: { $sum: '$taxable' }, cgst: { $sum: '$cgst' }, sgst: { $sum: '$sgst' }, igst: { $sum: '$igst' }, value: { $sum: '$amount' } } },
      { $project: { _id: 0, hsnCode: { $ifNull: ['$_id.h', '-'] }, gstRate: '$_id.r', qty: 1, taxable: { $round: ['$taxable', 2] }, cgst: { $round: ['$cgst', 2] }, sgst: { $round: ['$sgst', 2] }, igst: { $round: ['$igst', 2] }, value: { $round: ['$value', 2] } } },
      { $sort: { hsnCode: 1, gstRate: 1 } },
    ], ctx, ['qty', 'taxable', 'cgst', 'sgst', 'igst', 'value']),
  },
};

function stockCols() {
  return [C('productName', 'Product'), C('sku', 'SKU'), C('barcode', 'Barcode'), C('size', 'Size'), C('color', 'Color'), C('category', 'Category'), num('opening', 'Opening'), num('purchased', 'Purchased'), num('transferIn', 'Trf In'), num('salesReturned', 'Sales Ret'), num('sold', 'Sold'), num('purchaseReturned', 'Pur Ret'), num('transferOut', 'Trf Out'), num('adjustment', 'Adj'), num('current', 'Current'), money('value', 'Value')];
}

async function stockRows(ctx, { low, out }) {
  const settings = await settingsService.get(ctx.companyId);
  const threshold = Number(ctx.q.threshold ?? settings.stock.lowStockThreshold);
  const match = { companyId: ctx.companyId, ...ctx.branch };
  if (out) match.current = { $lte: 0 };
  if (low) match.current = { $gt: 0, $lte: threshold };
  const pipeline = [
    { $match: match },
    { $group: { _id: '$variantId', opening: { $sum: '$opening' }, purchased: { $sum: '$purchased' }, transferIn: { $sum: '$transferIn' }, salesReturned: { $sum: '$salesReturned' }, sold: { $sum: '$sold' }, purchaseReturned: { $sum: '$purchaseReturned' }, transferOut: { $sum: '$transferOut' }, adjustment: { $sum: '$adjustment' }, current: { $sum: '$current' }, value: { $sum: { $multiply: ['$current', '$avgCost'] } } } },
    { $lookup: { from: 'productvariants', localField: '_id', foreignField: '_id', as: 'v' } }, { $unwind: '$v' },
    { $match: { 'v.deletedAt': null, ...(ctx.search ? { $or: [{ 'v.searchText': { $regex: escapeRegex(ctx.search.toLowerCase()) } }, { 'v.barcode': ctx.search }] } : {}) } },
    { $project: { _id: 0, productName: '$v.productName', sku: '$v.sku', barcode: '$v.barcode', size: '$v.size', color: '$v.color', category: '$v.categoryName', opening: 1, purchased: 1, transferIn: 1, salesReturned: 1, sold: 1, purchaseReturned: 1, transferOut: 1, adjustment: 1, current: 1, value: { $round: ['$value', 2] } } },
    { $sort: { productName: 1, color: 1, _id: 1 } },
  ];
  return facet(Stock, pipeline, ctx, ['opening', 'purchased', 'transferIn', 'salesReturned', 'sold', 'purchaseReturned', 'transferOut', 'adjustment', 'current', 'value']);
}

async function movers(ctx, dir) {
  const stockMatch = { companyId: ctx.companyId, ...ctx.branch };
  const pipeline = [
    { $match: saleMatch(ctx) },
    { $group: { _id: '$variantId', productName: { $first: '$productName' }, sku: { $first: '$sku' }, size: { $first: '$size' }, color: { $first: '$color' }, qty: { $sum: { $subtract: ['$qty', '$returnedQty'] } }, bills: { $addToSet: '$saleId' }, amount: { $sum: '$amount' } } },
    { $lookup: { from: 'stocks', let: { v: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$variantId', '$$v'] }, ...stockMatch } }, { $group: { _id: null, c: { $sum: '$current' } } }], as: 's' } },
    { $project: { _id: 0, productName: 1, sku: 1, size: 1, color: 1, qty: 1, bills: { $size: '$bills' }, amount: { $round: ['$amount', 2] }, stock: { $ifNull: [{ $first: '$s.c' }, 0] } } },
    ...(dir === 1 ? [{ $match: { stock: { $gt: 0 } } }] : []),
    { $sort: { qty: dir, amount: dir } },
  ];
  return facet(SaleItem, pipeline, ctx, ['qty', 'bills', 'amount', 'stock']);
}

function catalogue(req) {
  return Object.entries(REPORTS)
    .filter(([, r]) => !r.financial || req.perms.has('reports.financial'))
    .map(([key, r]) => ({ key, group: r.group, title: r.title, financial: Boolean(r.financial) }));
}

async function run(req, key) {
  const def = REPORTS[key];
  if (!def) throw ApiError.notFound('Unknown report');
  if (def.financial && !req.perms.has('reports.financial')) throw ApiError.forbidden('Financial reports permission required');
  const ctx = ctxFrom(req);
  const result = await def.run(ctx);
  return { key, title: def.title, group: def.group, columns: def.columns, from: ctx.from, to: ctx.to, ...result };
}

/**
 * Everything about one product (variant) for the sales summary drill-down, in the report's period and branch:
 * the product, stock left per branch, every bill line it was sold on (customer, cashier, how the bill was paid)
 * and its purchases.
 */
async function productDetail(req, variantId) {
  if (!mongoose.isValidObjectId(variantId)) throw ApiError.badRequest('Invalid product');
  const ctx = ctxFrom(req);
  const vid = oid(variantId);
  const variant = await ProductVariant.findOne({ _id: vid, companyId: ctx.companyId })
    .select('productName productCode sku barcode size color categoryName brandName mrp sellingPrice purchasePrice gstRate hsnCode status').lean();
  if (!variant) throw ApiError.notFound('Product not found');
  const [names, stocks, lines, buys] = await Promise.all([
    branchNames(ctx.companyId),
    Stock.find({ companyId: ctx.companyId, ...ctx.branch, variantId: vid }).select('branchId current').lean(),
    SaleItem.find(saleMatch(ctx, { variantId: vid })).sort({ createdAt: -1 }).limit(1000)
      .select('saleId invoiceNumber branchId qty returnedQty rate discount amount taxable costPrice createdAt returnOf').lean(),
    PurchaseItem.find({ companyId: ctx.companyId, ...ctx.branch, variantId: vid, status: 'received' }).sort({ invoiceDate: -1, createdAt: -1 }).limit(100)
      .select('purchaseId branchId qty returnedQty rate mrp invoiceDate').lean(),
  ]);
  const [bills, purchases] = await Promise.all([
    Sale.find({ _id: { $in: [...new Set(lines.map((l) => String(l.saleId)))] } }).select('payments customer cashierName').lean(),
    Purchase.find({ _id: { $in: [...new Set(buys.map((b) => String(b.purchaseId)))] } }).select('purchaseNo supplierName invoiceNumber').lean(),
  ]);
  const bm = new Map(bills.map((b) => [String(b._id), b]));
  const pm = new Map(purchases.map((p) => [String(p._id), p]));
  const byMode = {};
  const sales = lines.map((l) => {
    const b = bm.get(String(l.saleId)) || {};
    const pays = (b.payments || []).filter((p) => Number(p.amount));
    const paid = pays.reduce((a, p) => a + Math.abs(p.amount), 0) || 1;
    const returned = l.qty > 0 ? Math.min(l.returnedQty || 0, l.qty) : 0;
    const amount = l.qty > 0 ? l.amount * ((l.qty - returned) / l.qty) : l.amount;
    // this line's money split the way its bill was paid
    pays.forEach((p) => { byMode[p.mode] = (byMode[p.mode] || 0) + (amount * Math.abs(p.amount)) / paid; });
    return {
      date: l.createdAt, invoiceNumber: l.invoiceNumber, branch: names.get(String(l.branchId)) || '',
      customer: b.customer?.name || 'Walk-in', mobile: b.customer?.mobile || '', cashier: b.cashierName || '',
      qty: l.qty, returned, rate: l.rate, discount: round2(l.discount || 0), amount: round2(l.amount),
      profit: round2((l.taxable || 0) * (l.qty > 0 ? (l.qty - returned) / l.qty : 1) - (l.costPrice || 0) * (l.qty > 0 ? l.qty - returned : l.qty)),
      returnOf: l.returnOf?.invoiceNumber || '',
      payment: pays.map((p) => `${modeName(p.mode)} ${round2(Math.abs(p.amount))}`).join(' + ') || '-',
    };
  });
  const sold = lines.filter((l) => l.qty > 0);
  const summary = {
    bills: new Set(lines.map((l) => String(l.saleId))).size,
    qty: sold.reduce((a, l) => a + l.qty, 0),
    returned: sales.reduce((a, s) => a + s.returned, 0) + lines.filter((l) => l.qty < 0).reduce((a, l) => a - l.qty, 0),
    sales: round2(sales.reduce((a, s) => a + (s.qty > 0 ? (s.amount * (s.qty - s.returned)) / s.qty : s.amount), 0)),
    discount: round2(sales.reduce((a, s) => a + s.discount, 0)),
    profit: round2(sales.reduce((a, s) => a + s.profit, 0)),
    byMode: Object.entries(byMode).map(([mode, amount]) => ({ mode: modeName(mode), amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
  };
  summary.netQty = summary.qty - summary.returned;
  return {
    variant,
    stock: stocks.map((s) => ({ branch: names.get(String(s.branchId)) || '', current: s.current })).sort((a, b) => a.branch.localeCompare(b.branch)),
    totalStock: stocks.reduce((a, s) => a + (s.current || 0), 0),
    summary,
    sales,
    purchases: buys.map((p) => {
      const h = pm.get(String(p.purchaseId)) || {};
      return { date: p.invoiceDate, purchaseNo: h.purchaseNo || '', supplier: h.supplierName || '', billNo: h.invoiceNumber || '', branch: names.get(String(p.branchId)) || '', qty: p.qty, returned: p.returnedQty || 0, rate: p.rate, mrp: p.mrp };
    }),
    from: ctx.from,
    to: ctx.to,
  };
}

module.exports = { catalogue, run, productDetail };
