const { Sale, SaleItem, SaleReturn, ProductVariant, Customer, Branch, Company, Payment, HeldBill, CashSession } = require('../models');
const ApiError = require('../utils/ApiError');
const { paginate, dateRange, escapeRegex, round2 } = require('../utils/common');
const { runInTransaction } = require('../utils/transaction');
const { computeTotals, isInterState } = require('../utils/gst');
const settingsService = require('./settings.service');
const stockService = require('./stock.service');
const paymentService = require('./payment.service');
const loyaltyService = require('./loyalty.service');
const audit = require('./audit.service');

const MONEY_MODES = ['cash', 'card', 'upi', 'bank'];

/**
 * Validates and prices the cart server-side (never trusts client totals) and enforces
 * price-change / discount permissions.
 */
async function priceCart(req, session, { items, billDiscount = 0, customer, branch, settings, allowReturns = false, origItems = new Map(), withGst = true }) {
  if (!items?.length) throw ApiError.badRequest('Add at least one item to the bill');
  const ids = [...new Set(items.map((i) => String(i.variantId)))];
  const variants = await ProductVariant.find({ _id: { $in: ids }, companyId: req.companyId }).session(session).lean();
  const vm = new Map(variants.map((v) => [String(v._id), v]));
  const canDiscount = req.perms.has('sale.discount');
  const canChangePrice = req.perms.has('sale.price_change');

  const raw = items.map((it) => {
    const v = vm.get(String(it.variantId));
    if (!v || v.deletedAt) throw ApiError.badRequest('Item not found in catalogue');
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty === 0 || (qty < 0 && !allowReturns)) throw ApiError.badRequest(`Invalid quantity for ${v.sku}`);
    const isReturn = qty < 0; // item returned at the counter inside this bill
    if (isReturn && !req.perms.has('sale.return')) throw ApiError.forbidden('You are not allowed to take returns');
    if (!isReturn && v.status !== 'active') throw ApiError.badRequest(`${v.productName} (${v.sku}) is inactive and cannot be sold`);
    const o = it.saleItemId ? origItems.get(String(it.saleItemId)) : null;
    if (it.saleItemId && (!o || !isReturn || String(o.variantId) !== String(v._id))) throw ApiError.badRequest(`Return line for ${v.sku} does not match the old bill`);
    if (o) {
      // returned from an earlier bill: refund exactly what was paid for these pieces on that bill
      const n = -qty;
      return {
        variantId: v._id, productId: v.productId, productName: v.productName, sku: v.sku, barcode: v.barcode, size: v.size, color: v.color,
        hsnCode: o.hsnCode || v.hsnCode, qty, rate: o.rate, discount: round2(((o.discount || 0) * n) / o.qty), discountPercent: 0, gstRate: o.gstRate, mrp: o.mrp ?? v.mrp, originalRate: o.originalRate ?? o.rate,
        categoryId: v.categoryId, categoryName: v.categoryName, brandId: v.brandId, brandName: v.brandName, purchasePrice: v.purchasePrice,
        returnOf: { saleId: o.saleId, saleItemId: o._id, invoiceNumber: o.invoiceNumber }, origCost: o.costPrice,
      };
    }
    const rate = it.rate != null ? round2(it.rate) : v.sellingPrice;
    if (rate < 0) throw ApiError.badRequest(`Invalid rate for ${v.sku}`);
    if (rate !== round2(v.sellingPrice) && !canChangePrice) {
      throw ApiError.forbidden(`Unauthorized price change for ${v.sku} (₹${v.sellingPrice} → ₹${rate})`);
    }
    if (v.mrp && rate > v.mrp) throw ApiError.badRequest(`Rate for ${v.sku} cannot exceed MRP ₹${v.mrp}`);
    const discount = round2(it.discount || 0);
    const discountPercent = Number(it.discountPercent || 0);
    // a return line repeats the discount its piece was billed with: that only lowers the refund, so no permission is needed
    if (!isReturn && (discount > 0 || discountPercent > 0) && !canDiscount) throw ApiError.forbidden('Unauthorized discount: you are not allowed to give discounts');
    if (!isReturn && (discount > 0 || discountPercent > 0) && !settings.discount.allowLineDiscount) throw ApiError.badRequest('Line discounts are disabled in settings');
    if (discount < 0 || discountPercent < 0 || discountPercent > 100) throw ApiError.badRequest(`Invalid discount for ${v.sku}`);
    return {
      variantId: v._id, productId: v.productId, productName: v.productName, sku: v.sku, barcode: v.barcode, size: v.size, color: v.color,
      hsnCode: v.hsnCode, qty, rate, discount, discountPercent, gstRate: withGst ? v.gstRate : 0, mrp: v.mrp, originalRate: v.sellingPrice,
      categoryId: v.categoryId, categoryName: v.categoryName, brandId: v.brandId, brandName: v.brandName, purchasePrice: v.purchasePrice,
    };
  });

  if (billDiscount > 0) {
    if (!canDiscount) throw ApiError.forbidden('Unauthorized discount: you are not allowed to give discounts');
    if (!settings.discount.allowBillDiscount) throw ApiError.badRequest('Bill discount is disabled in settings');
  }
  const interState = isInterState(settings.tax, branch, customer);
  const result = computeTotals(raw, { taxInclusive: settings.tax.taxInclusive, interState, billDiscount });
  const { totals } = result;
  // discount limits are measured against the sold lines only (return lines would shrink the base)
  const sold = result.lines.filter((l) => l.qty > 0);
  const soldGross = round2(sold.reduce((a, l) => a + l.gross, 0));
  const soldDiscount = round2(sold.reduce((a, l) => a + l.discountTotal, 0));
  if (soldDiscount > 0 && soldGross > 0) {
    const pct = round2((soldDiscount / soldGross) * 100);
    const roleMax = req.role.maxDiscountPercent ?? 0;
    if (pct > roleMax + 0.001) throw ApiError.forbidden(`Unauthorized discount: ${pct}% exceeds your limit of ${roleMax}%`);
    if (billDiscount > 0 && round2((totals.billDiscount / soldGross) * 100) > settings.discount.maxBillDiscountPercent) {
      throw ApiError.badRequest(`Bill discount exceeds the maximum of ${settings.discount.maxBillDiscountPercent}%`);
    }
  }
  return { ...result, interState };
}

/** Validates the payment split against the grand total. Returns normalised lines + change. */
function settlePayments({ payments, grandTotal, customer, settings, internalCredit = 0 }) {
  const lines = (payments || []).filter((p) => Number(p.amount) > 0).map((p) => ({ mode: p.mode, amount: round2(p.amount), reference: p.reference }));
  if (internalCredit > 0) lines.unshift({ mode: 'exchange', amount: round2(internalCredit) });
  const enabled = settings.payment.enabledModes;
  for (const p of lines) {
    if (p.mode === 'exchange' && internalCredit > 0) continue;
    if (!enabled.includes(p.mode)) throw ApiError.badRequest(`Payment mode "${p.mode}" is not enabled`);
    if (p.mode === 'exchange') throw ApiError.badRequest('Invalid payment mode');
  }
  const total = round2(lines.reduce((a, p) => a + p.amount, 0));
  const cash = round2(lines.filter((p) => p.mode === 'cash').reduce((a, p) => a + p.amount, 0));
  const nonCash = round2(total - cash);
  if (grandTotal > 0 && !lines.length) throw ApiError.badRequest('Enter payment');
  if (nonCash > grandTotal + 0.001) throw ApiError.badRequest('Non-cash payments exceed the bill amount');
  if (total + 0.001 < grandTotal) throw ApiError.badRequest(`Payment short by ₹${round2(grandTotal - total)}`);
  const change = round2(total - grandTotal);
  if (change > cash + 0.001) throw ApiError.badRequest('Excess payment is only allowed in cash (change)');

  const credit = lines.filter((p) => p.mode === 'credit').reduce((a, p) => a + p.amount, 0);
  if (credit > 0 && !customer) throw ApiError.badRequest('Select a customer for credit sale');
  const storeCredit = lines.filter((p) => p.mode === 'store_credit').reduce((a, p) => a + p.amount, 0);
  if (storeCredit > 0) {
    if (!customer) throw ApiError.badRequest('Select a customer to use store credit');
    if (storeCredit > round2(customer.storeCredit) + 0.001) throw ApiError.badRequest(`Store credit available is only ₹${round2(customer.storeCredit)}`);
  }
  const loyaltyAmt = lines.filter((p) => p.mode === 'loyalty').reduce((a, p) => a + p.amount, 0);
  let redeemPoints = 0;
  if (loyaltyAmt > 0) {
    if (!settings.loyalty.enabled) throw ApiError.badRequest('Loyalty is disabled');
    if (!customer) throw ApiError.badRequest('Select a customer to redeem loyalty points');
    redeemPoints = Math.round(loyaltyAmt / settings.loyalty.pointValue);
    if (round2(redeemPoints * settings.loyalty.pointValue) !== round2(loyaltyAmt)) throw ApiError.badRequest('Loyalty amount must be a whole number of points');
    if (redeemPoints > customer.loyaltyPoints) throw ApiError.badRequest(`Customer has only ${customer.loyaltyPoints} points`);
    if (redeemPoints < settings.loyalty.minRedeemPoints) throw ApiError.badRequest(`Minimum ${settings.loyalty.minRedeemPoints} points required to redeem`);
  }
  // store the cash line net of change
  if (change > 0) {
    let left = change;
    for (const p of lines) {
      if (p.mode === 'cash' && left > 0) {
        const take = Math.min(p.amount, left);
        p.amount = round2(p.amount - take);
        left = round2(left - take);
      }
    }
  }
  return { lines: lines.filter((p) => p.amount > 0), tendered: total, change, credit: round2(credit), storeCredit: round2(storeCredit), loyaltyAmt: round2(loyaltyAmt), redeemPoints };
}

/**
 * Minus lines that return items of an earlier bill (old bill scanned in POS): checks that bill is
 * completed, inside the return-policy days, and still has that many pieces left to return.
 * Returns Map(saleItemId -> original SaleItem doc).
 */
async function loadReturnedFromOldBills(session, req, items, settings, saleType) {
  const linked = (items || []).filter((i) => i.saleItemId);
  if (!linked.length) return new Map();
  if (saleType !== 'sale') throw ApiError.badRequest('Old-bill returns are only allowed in POS billing');
  const ids = [...new Set(linked.map((i) => String(i.saleItemId)))];
  const originals = await SaleItem.find({ _id: { $in: ids }, companyId: req.companyId }).session(session);
  const map = new Map(originals.map((o) => [String(o._id), o]));
  const sales = await Sale.find({ _id: { $in: [...new Set(originals.map((o) => String(o.saleId)))] }, companyId: req.companyId }).session(session).lean();
  const saleMap = new Map(sales.map((s) => [String(s._id), s]));
  const wanted = new Map();
  linked.forEach((i) => wanted.set(String(i.saleItemId), (wanted.get(String(i.saleItemId)) || 0) - Number(i.qty)));
  for (const [sid, n] of wanted) {
    const o = map.get(sid);
    const sale = o && saleMap.get(String(o.saleId));
    if (!o || !sale) throw ApiError.badRequest('Returned item not found on the old bill');
    if (req.allowedBranchIds && !req.allowedBranchIds.includes(String(sale.branchId)) && !req.allowedBranchIds.includes(String(req.branchId))) throw ApiError.forbidden();
    if (sale.status !== 'completed') throw ApiError.badRequest(`Bill ${sale.invoiceNumber} is cancelled; it cannot be returned`);
    if (o.qty <= 0) throw ApiError.badRequest(`${o.productName} was itself a return on bill ${sale.invoiceNumber}`);
    const policy = settings.returnPolicy;
    if (!policy?.enabled) throw ApiError.badRequest('Returns are disabled in settings');
    const days = (Date.now() - new Date(sale.createdAt).getTime()) / 86400000;
    if (days > policy.days && !req.perms.has('sale.cancel')) throw ApiError.badRequest(`Return period of ${policy.days} days has expired for bill ${sale.invoiceNumber}`);
    const left = o.qty - (o.returnedQty || 0);
    if (n <= 0 || n > left) throw ApiError.badRequest(`Bill ${sale.invoiceNumber}: only ${left} of ${o.productName} ${o.size || ''} can still be returned`);
    o.invoiceNumber = sale.invoiceNumber;
  }
  return map;
}

/** Marks the returned pieces on the old bill (or reverses that when this bill is cancelled: sign = -1). */
async function applyOldBillReturns(session, lines, sign = 1) {
  const bySale = new Map();
  for (const l of lines) {
    if (!l.returnOf?.saleItemId) continue;
    const n = -l.qty * sign;
    await SaleItem.updateOne({ _id: l.returnOf.saleItemId }, { $inc: { returnedQty: n } }, { session });
    const k = String(l.returnOf.saleId);
    bySale.set(k, round2((bySale.get(k) || 0) + Math.abs(l.amount) * sign));
  }
  for (const [saleId, amt] of bySale) {
    const sale = await Sale.findById(saleId).session(session);
    if (!sale) continue;
    const items = await SaleItem.find({ saleId }).session(session).lean();
    const sold = items.filter((i) => i.qty > 0);
    const left = sold.reduce((a, i) => a + (i.qty - (i.returnedQty || 0)), 0);
    const any = sold.some((i) => (i.returnedQty || 0) > 0);
    sale.returnedAmount = round2(Math.max(0, (sale.returnedAmount || 0) + amt));
    sale.returnStatus = !any ? 'none' : left === 0 ? 'full' : 'partial';
    await sale.save({ session });
  }
}

/**
 * Counter returns made the bill total negative: the shop pays the difference back.
 * Stored as one payment line with a negative amount (cash / card / UPI / bank refund, or store credit).
 */
function settleRefund({ refundMode = 'cash', grandTotal, customer, settings }) {
  const refund = round2(-grandTotal);
  if (refundMode === 'store_credit') {
    if (!customer) throw ApiError.badRequest('Select a customer to refund as store credit');
  } else if (!MONEY_MODES.includes(refundMode)) throw ApiError.badRequest('Invalid refund mode');
  else if (!settings.payment.enabledModes.includes(refundMode)) throw ApiError.badRequest(`Payment mode "${refundMode}" is not enabled`);
  return {
    lines: [{ mode: refundMode, amount: -refund }], tendered: -refund, change: 0, credit: 0,
    storeCredit: refundMode === 'store_credit' ? -refund : 0, loyaltyAmt: 0, redeemPoints: 0,
  };
}

/** Creates a sale inside an existing transaction. Used by POS billing and exchanges. */
async function createSaleInternal(session, req, data, { saleType = 'sale', internalCredit = 0, exchangeId } = {}) {
  const branchId = req.branchId;
  if (!branchId) throw ApiError.badRequest('Select a specific branch to bill');
  const settings = await settingsService.get(req.companyId);
  if (settings.cash.requireSessionForBilling && !(await paymentService.openSessionId(req, branchId, session))) {
    throw ApiError.badRequest('Open a cash session before billing (Accounts → Cash)');
  }
  const branch = await Branch.findById(branchId).session(session).lean();
  const customer = data.customerId ? await Customer.findOne({ _id: data.customerId, companyId: req.companyId }).session(session) : null;
  if (data.customerId && !customer) throw ApiError.badRequest('Customer not found');

  const origItems = await loadReturnedFromOldBills(session, req, data.items, settings, saleType);
  // "without GST" bill: sold items carry no GST (items returned from an earlier bill keep that bill's GST)
  const withGst = data.withGst !== false;
  const { lines, totals, interState } = await priceCart(req, session, { items: data.items, billDiscount: data.billDiscount, customer, branch, settings, allowReturns: saleType === 'sale', origItems, withGst });
  const pay = totals.grandTotal < 0
    ? settleRefund({ refundMode: data.refundMode, grandTotal: totals.grandTotal, customer, settings })
    : settlePayments({ payments: data.payments, grandTotal: totals.grandTotal, customer, settings, internalCredit });

  const invoiceNumber = await settingsService.nextNumber(req.companyId, 'invoice', { branchId, session });
  const stockMap = await stockService.getStockMap(branchId, lines.map((l) => l.variantId), session);
  const costOf = (l) => (l.returnOf ? l.origCost : undefined) ?? stockMap.get(String(l.variantId))?.avgCost ?? l.purchasePrice ?? 0;
  const costTotal = round2(lines.reduce((a, l) => a + costOf(l) * l.qty, 0));
  const cashSessionId = await paymentService.openSessionId(req, branchId, session);

  const [sale] = await Sale.create([{
    companyId: req.companyId, branchId, invoiceNumber, invoiceDate: new Date(), saleType, exchangeId,
    customerId: customer?._id,
    customer: customer ? { name: customer.name, mobile: customer.mobile, gstNumber: customer.gstNumber, address: customer.address } : undefined,
    cashierId: req.user._id, cashierName: req.user.name, itemCount: lines.length, totals, interState, taxInclusive: settings.tax.taxInclusive, withGst,
    payments: pay.lines, paidAmount: round2(totals.grandTotal - pay.credit), creditAmount: pay.credit,
    tenderedAmount: pay.tendered, changeReturned: pay.change, costTotal, notes: data.notes, cashSessionId,
  }], { session });

  const itemDocs = lines.map((l) => ({
    companyId: req.companyId, branchId, saleId: sale._id, invoiceNumber, customerId: customer?._id, cashierId: req.user._id,
    variantId: l.variantId, productId: l.productId, productName: l.productName, sku: l.sku, barcode: l.barcode, size: l.size, color: l.color,
    hsnCode: l.hsnCode, qty: l.qty, rate: l.rate, discount: l.discountTotal, gstRate: l.gstRate, taxable: l.taxable,
    cgst: l.cgst, sgst: l.sgst, igst: l.igst, taxAmount: l.taxAmount, amount: l.amount, mrp: l.mrp, originalRate: l.originalRate,
    categoryId: l.categoryId, categoryName: l.categoryName, brandId: l.brandId, brandName: l.brandName, costPrice: costOf(l), returnOf: l.returnOf,
  }));
  await SaleItem.insertMany(itemDocs, { session });
  await applyOldBillReturns(session, lines);

  for (const l of lines) {
    await stockService.applyMovement({
      session, companyId: req.companyId, branchId, variant: { _id: l.variantId, productId: l.productId, productName: l.productName, sku: l.sku, size: l.size, color: l.color },
      qty: -l.qty, type: l.qty < 0 ? 'sale_return' : 'sale', refType: 'Sale', refId: sale._id, refNo: invoiceNumber, userId: req.user._id, costPrice: costOf(l),
      note: l.qty < 0 ? 'Returned at counter' : undefined,
    });
  }

  for (const p of pay.lines) {
    if (MONEY_MODES.includes(p.mode)) {
      const refund = p.amount < 0;
      await paymentService.record(session, req, {
        branchId, direction: refund ? 'out' : 'in', type: refund ? 'sale_refund' : 'sale', mode: p.mode, amount: Math.abs(p.amount), reference: p.reference,
        partyType: customer ? 'customer' : 'none', partyId: customer?._id, partyName: customer?.name, refType: 'Sale', refId: sale._id, refNo: invoiceNumber,
      });
    }
  }

  if (customer) {
    customer.outstanding = round2(customer.outstanding + pay.credit);
    customer.storeCredit = round2(customer.storeCredit - pay.storeCredit);
    customer.totalPurchases = round2(customer.totalPurchases + totals.grandTotal);
    customer.totalBills += 1;
    customer.lastPurchaseAt = new Date();
    await customer.save({ session });
    if (pay.redeemPoints > 0) {
      await loyaltyService.add(session, req, customer, -pay.redeemPoints, { type: 'redeem', refType: 'Sale', refId: sale._id, refNo: invoiceNumber, branchId });
      sale.loyaltyRedeemed = pay.redeemPoints;
    }
    if (settings.loyalty.enabled && saleType === 'sale') {
      const eligible = totals.grandTotal - pay.loyaltyAmt - pay.storeCredit;
      const earn = Math.floor(Math.max(0, eligible) / settings.loyalty.amountPerPoint);
      if (earn > 0) {
        await loyaltyService.add(session, req, customer, earn, { type: 'earn', refType: 'Sale', refId: sale._id, refNo: invoiceNumber, branchId });
        sale.loyaltyEarned = earn;
      }
    }
    if (sale.loyaltyEarned || sale.loyaltyRedeemed) await sale.save({ session });
  }

  if (data.heldBillId) await HeldBill.deleteOne({ _id: data.heldBillId, companyId: req.companyId }, { session });
  return sale;
}

async function create(req, data) {
  const sale = await runInTransaction((session) => createSaleInternal(session, req, data));
  await audit.log(req, {
    action: 'sale.create', entity: 'Sale', entityId: sale._id, refNo: sale.invoiceNumber, branchId: sale.branchId,
    newValue: { invoiceNumber: sale.invoiceNumber, totals: sale.totals, payments: sale.payments, customer: sale.customer },
  });
  if (sale.totals.discount > 0) {
    await audit.log(req, { action: 'sale.discount', entity: 'Sale', entityId: sale._id, refNo: sale.invoiceNumber, branchId: sale.branchId, newValue: { discount: sale.totals.discount, billDiscount: sale.totals.billDiscount, subtotal: sale.totals.subtotal } });
  }
  return invoice(req, sale._id);
}

/** Full invoice payload for printing (sale + items + company/branch + invoice settings). */
async function invoice(req, id) {
  const sale = await Sale.findOne({ _id: id, companyId: req.companyId }).lean();
  if (!sale) throw ApiError.notFound('Invoice not found');
  if (req.allowedBranchIds && !req.allowedBranchIds.includes(String(sale.branchId))) throw ApiError.forbidden();
  const [items, branch, company, settings, returns] = await Promise.all([
    SaleItem.find({ saleId: id }).sort({ _id: 1 }).lean(),
    Branch.findById(sale.branchId).lean(),
    Company.findById(sale.companyId).lean(),
    settingsService.get(req.companyId),
    SaleReturn.find({ saleId: id }).sort({ createdAt: -1 }).lean(),
  ]);
  const savings = round2(items.reduce((a, i) => a + Math.max(0, (i.mrp || i.rate) * i.qty - i.amount), 0));
  const hsnSummary = Object.values(items.reduce((acc, i) => {
    const k = `${i.hsnCode || '-'}|${i.gstRate}`;
    acc[k] = acc[k] || { hsnCode: i.hsnCode || '-', gstRate: i.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    ['taxable', 'cgst', 'sgst', 'igst'].forEach((f) => { acc[k][f] = round2(acc[k][f] + i[f]); });
    return acc;
  }, {}));
  return {
    sale, items, branch, company, returns, savings, hsnSummary,
    settings: { invoice: settings.invoice, printer: settings.printer, returnPolicy: settings.returnPolicy, exchangePolicy: settings.exchangePolicy, payment: { upiId: settings.payment.upiId } },
  };
}

async function markPrinted(req, id, duplicate) {
  const sale = await Sale.findOneAndUpdate({ _id: id, companyId: req.companyId }, { $inc: { printCount: 1 } }, { new: true }).lean();
  if (!sale) throw ApiError.notFound('Invoice not found');
  if (sale.printCount > 1 || duplicate) await audit.log(req, { action: duplicate ? 'sale.duplicate_print' : 'sale.reprint', entity: 'Sale', entityId: id, refNo: sale.invoiceNumber, branchId: sale.branchId });
  return { printCount: sale.printCount };
}

async function list(req) {
  const q = req.query;
  const filter = { companyId: req.companyId, ...req.branchScope, ...dateRange(q.from, q.to) };
  if (q.status) filter.status = q.status;
  if (q.cashierId) filter.cashierId = q.cashierId;
  if (q.customerId) filter.customerId = q.customerId;
  if (q.saleType) filter.saleType = q.saleType;
  if (q.paymentMode) filter['payments.mode'] = q.paymentMode;
  if (q.search) {
    const s = String(q.search).trim();
    const rx = new RegExp(escapeRegex(s), 'i');
    filter.$or = [{ invoiceNumber: rx }, { 'customer.mobile': rx }, { 'customer.name': rx }];
  }
  const res = await paginate(Sale, filter, q, { populate: { path: 'branchId', select: 'name code' } });
  const [agg] = await Sale.aggregate([{ $match: { ...filter, status: 'completed' } }, { $group: { _id: null, total: { $sum: '$totals.grandTotal' }, bills: { $sum: 1 } } }]);
  res.summary = agg || { total: 0, bills: 0 };
  return res;
}

/** Find a sale by invoice number (for returns / exchange / reprint). */
async function findByInvoice(req, invoiceNumber) {
  const filter = { companyId: req.companyId, invoiceNumber: String(invoiceNumber).trim() };
  if (req.allowedBranchIds) filter.branchId = { $in: req.allowedBranchIds };
  const sales = await Sale.find(filter).select('_id branchId').lean();
  if (!sales.length) throw ApiError.notFound(`Invoice ${invoiceNumber} not found`);
  const match = sales.find((s) => req.branchId && String(s.branchId) === String(req.branchId)) || sales[0];
  return invoice(req, match._id);
}

/** Edit: customer, notes and payment-mode correction (amounts must still match). Items change via return/exchange. */
async function edit(req, id, data) {
  const before = await invoice(req, id);
  const sale0 = before.sale;
  if (sale0.status !== 'completed') throw ApiError.badRequest('Cancelled bills cannot be edited');
  await runInTransaction(async (session) => {
    const sale = await Sale.findById(id).session(session);
    if (data.notes !== undefined) sale.notes = data.notes;
    if (data.customerId !== undefined && String(data.customerId || '') !== String(sale.customerId || '')) {
      if (sale.creditAmount > 0 || sale.loyaltyEarned || sale.loyaltyRedeemed || sale.payments.some((p) => p.mode === 'store_credit')) {
        throw ApiError.badRequest('Customer cannot be changed on bills with credit, store credit or loyalty points');
      }
      if (sale.returnStatus !== 'none') throw ApiError.badRequest('Customer cannot be changed after a return');
      const old = sale.customerId ? await Customer.findById(sale.customerId).session(session) : null;
      const nw = data.customerId ? await Customer.findOne({ _id: data.customerId, companyId: req.companyId }).session(session) : null;
      if (data.customerId && !nw) throw ApiError.badRequest('Customer not found');
      if (old) { old.totalPurchases = round2(old.totalPurchases - sale.totals.grandTotal); old.totalBills -= 1; await old.save({ session }); }
      if (nw) { nw.totalPurchases = round2(nw.totalPurchases + sale.totals.grandTotal); nw.totalBills += 1; nw.lastPurchaseAt = sale.createdAt; await nw.save({ session }); }
      sale.customerId = nw?._id;
      sale.customer = nw ? { name: nw.name, mobile: nw.mobile, gstNumber: nw.gstNumber, address: nw.address } : undefined;
      await SaleItem.updateMany({ saleId: id }, { $set: { customerId: nw?._id } }, { session });
      await Payment.updateMany({ refId: sale._id, type: 'sale' }, { $set: { partyId: nw?._id, partyName: nw?.name, partyType: nw ? 'customer' : 'none' } }, { session });
    }
    if (data.payments) {
      if (sale.payments.some((p) => p.amount < 0)) throw ApiError.badRequest('Refund bills: the refund mode cannot be changed');
      const fixed = sale.payments.filter((p) => !MONEY_MODES.includes(p.mode));
      const editable = round2(sale.payments.filter((p) => MONEY_MODES.includes(p.mode)).reduce((a, p) => a + p.amount, 0));
      const lines = data.payments.filter((p) => p.amount > 0).map((p) => ({ mode: p.mode, amount: round2(p.amount), reference: p.reference }));
      if (lines.some((p) => !MONEY_MODES.includes(p.mode))) throw ApiError.badRequest('Only cash / card / UPI / bank amounts can be re-allocated');
      if (round2(lines.reduce((a, p) => a + p.amount, 0)) !== editable) throw ApiError.badRequest(`Payment total must remain ₹${editable}`);
      await Payment.deleteMany({ refId: sale._id, type: 'sale' }, { session });
      for (const p of lines) {
        await paymentService.record(session, req, {
          branchId: sale.branchId, direction: 'in', type: 'sale', mode: p.mode, amount: p.amount, reference: p.reference, date: sale.createdAt,
          partyType: sale.customerId ? 'customer' : 'none', partyId: sale.customerId, partyName: sale.customer?.name, refType: 'Sale', refId: sale._id, refNo: sale.invoiceNumber,
        });
      }
      sale.payments = [...fixed, ...lines];
    }
    await sale.save({ session });
  });
  const after = await invoice(req, id);
  await audit.log(req, { action: 'sale.edit', entity: 'Sale', entityId: id, refNo: sale0.invoiceNumber, branchId: sale0.branchId, oldValue: { customer: sale0.customer, payments: sale0.payments, notes: sale0.notes }, newValue: { customer: after.sale.customer, payments: after.sale.payments, notes: after.sale.notes } });
  return after;
}

/** Cancel: full reversal of stock, payments, credit, store credit and loyalty. */
async function cancel(req, id, reason) {
  if (!reason) throw ApiError.badRequest('Cancellation reason is required');
  const result = await runInTransaction(async (session) => {
    const sale = await Sale.findOne({ _id: id, companyId: req.companyId }).session(session);
    if (!sale) throw ApiError.notFound('Invoice not found');
    if (req.allowedBranchIds && !req.allowedBranchIds.includes(String(sale.branchId))) throw ApiError.forbidden();
    if (sale.status === 'cancelled') throw ApiError.badRequest('Bill is already cancelled');
    if (sale.returnStatus !== 'none') throw ApiError.badRequest('Bill has returns; it cannot be cancelled');
    if (sale.saleType === 'exchange') throw ApiError.badRequest('Exchange bills cannot be cancelled');
    const originalCredit = sale.payments.filter((p) => p.mode === 'credit').reduce((a, p) => a + p.amount, 0);
    if (round2(originalCredit) !== round2(sale.creditAmount)) throw ApiError.badRequest('A customer receipt was recorded against this credit bill; it cannot be cancelled');
    const items = await SaleItem.find({ saleId: id }).session(session);
    for (const it of items) {
      await stockService.applyMovement({
        session, companyId: req.companyId, branchId: sale.branchId, variant: { _id: it.variantId, productId: it.productId },
        qty: it.qty, type: 'sale_cancel', refType: 'Sale', refId: sale._id, refNo: sale.invoiceNumber, userId: req.user._id, costPrice: it.costPrice, note: reason,
      });
    }
    await SaleItem.updateMany({ saleId: id }, { $set: { status: 'cancelled' } }, { session });
    await applyOldBillReturns(session, items, -1); // old-bill items returned on this bill become returnable again
    for (const p of sale.payments) {
      if (MONEY_MODES.includes(p.mode)) {
        // a refund line (negative, from counter returns) is reversed as money coming back in
        const wasRefund = p.amount < 0;
        await paymentService.record(session, req, {
          branchId: sale.branchId, direction: wasRefund ? 'in' : 'out', type: wasRefund ? 'sale' : 'sale_cancel', mode: p.mode, amount: Math.abs(p.amount), reference: p.reference,
          partyType: sale.customerId ? 'customer' : 'none', partyId: sale.customerId, partyName: sale.customer?.name, refType: 'Sale', refId: sale._id, refNo: sale.invoiceNumber, notes: reason,
        });
      }
    }
    if (sale.customerId) {
      const customer = await Customer.findById(sale.customerId).session(session);
      const sc = sale.payments.filter((p) => p.mode === 'store_credit').reduce((a, p) => a + p.amount, 0);
      customer.outstanding = round2(customer.outstanding - sale.creditAmount);
      customer.storeCredit = round2(customer.storeCredit + sc);
      customer.totalPurchases = round2(customer.totalPurchases - sale.totals.grandTotal);
      customer.totalBills = Math.max(0, customer.totalBills - 1);
      await customer.save({ session });
      const net = (sale.loyaltyRedeemed || 0) - (sale.loyaltyEarned || 0);
      if (net !== 0) await loyaltyService.add(session, req, customer, net, { type: 'reverse', refType: 'Sale', refId: sale._id, refNo: sale.invoiceNumber, branchId: sale.branchId, note: 'Bill cancelled', clamp: true });
    }
    sale.status = 'cancelled';
    sale.creditAmount = 0;
    sale.cancelledBy = req.user._id;
    sale.cancelledAt = new Date();
    sale.cancelReason = reason;
    await sale.save({ session });
    return sale;
  });
  await audit.log(req, { action: 'sale.cancel', entity: 'Sale', entityId: id, refNo: result.invoiceNumber, branchId: result.branchId, oldValue: { status: 'completed', totals: result.totals }, newValue: { status: 'cancelled', reason } });
  return result;
}

/* ---------- Hold / Recall ---------- */
async function holdBill(req, data) {
  if (!req.branchId) throw ApiError.badRequest('Select a branch');
  const holdNo = await settingsService.nextNumber(req.companyId, 'hold', { branchId: req.branchId });
  const customer = data.customerId ? await Customer.findById(data.customerId).lean() : null;
  const doc = await HeldBill.create({
    companyId: req.companyId, branchId: req.branchId, holdNo, cashierId: req.user._id, cashierName: req.user.name,
    customerId: customer?._id, customerName: customer?.name, customerMobile: customer?.mobile,
    items: data.items, billDiscount: data.billDiscount || 0, itemCount: data.items.length, amount: data.amount, note: data.note,
  });
  return doc;
}
const listHeld = (req) => HeldBill.find({ companyId: req.companyId, ...req.branchScope }).sort({ createdAt: -1 }).limit(100).lean();
async function getHeld(req, id) {
  const doc = await HeldBill.findOne({ _id: id, companyId: req.companyId, ...req.branchScope }).lean();
  if (!doc) throw ApiError.notFound('Held bill not found');
  // refresh live stock for recall
  const sm = await stockService.getStockMap(doc.branchId, doc.items.map((i) => i.variantId));
  doc.items = doc.items.map((i) => ({ ...i, stock: sm.get(String(i.variantId))?.current || 0 }));
  return doc;
}
async function deleteHeld(req, id) {
  const r = await HeldBill.deleteOne({ _id: id, companyId: req.companyId, ...req.branchScope });
  if (!r.deletedCount) throw ApiError.notFound('Held bill not found');
}

/** Today's quick stats for the POS header. */
async function counterStats(req) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [agg] = await Sale.aggregate([
    { $match: { companyId: req.companyId, branchId: req.branchId, cashierId: req.user._id, status: 'completed', createdAt: { $gte: start } } },
    { $group: { _id: null, bills: { $sum: 1 }, amount: { $sum: '$totals.grandTotal' } } },
  ]);
  const session = req.branchId ? await CashSession.findOne({ companyId: req.companyId, branchId: req.branchId, userId: req.user._id, status: 'open' }).select('sessionNo openedAt').lean() : null;
  const last = await Sale.findOne({ companyId: req.companyId, branchId: req.branchId, cashierId: req.user._id }).sort({ createdAt: -1 }).select('invoiceNumber').lean();
  return { bills: agg?.bills || 0, amount: agg?.amount || 0, cashSession: session, lastInvoice: last };
}

module.exports = {
  priceCart, settlePayments, createSaleInternal, create, invoice, markPrinted, list, findByInvoice, edit, cancel,
  holdBill, listHeld, getHeld, deleteHeld, counterStats, MONEY_MODES,
};
