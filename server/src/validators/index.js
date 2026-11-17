const { z } = require('zod');
const mongoose = require('mongoose');

const id = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const optId = z.union([id, z.literal(''), z.null()]).optional().transform((v) => v || undefined);
const money = z.coerce.number().min(0, 'Must be zero or more').max(1e9);
const qty = z.coerce.number().int('Quantity must be a whole number').positive('Quantity must be greater than zero').max(100000);
const gst = z.coerce.number().refine((v) => [0, 5, 12, 18, 28].includes(v), 'Invalid GST % (allowed 0, 5, 12, 18, 28)');
const str = (max = 200) => z.string().trim().max(max);
const optStr = (max = 200) => z.string().trim().max(max).optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v));
const mobile = z.string().trim().transform((v) => v.replace(/\D/g, '').slice(-10)).refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number');
const gstin = z.string().trim().toUpperCase().refine((v) => !v || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), 'Invalid GSTIN format').optional().or(z.literal(''));
const date = z.coerce.date();
const address = z.object({ line1: optStr(), line2: optStr(), city: optStr(), state: optStr(), stateCode: optStr(5), pincode: optStr(10) }).partial().optional();
const paymentMode = z.enum(['cash', 'card', 'upi', 'bank', 'credit', 'store_credit', 'loyalty']);
const payments = z.array(z.object({ mode: paymentMode, amount: money, reference: optStr(100) })).max(10);

const auth = {
  login: z.object({ username: str(60).min(1, 'Username is required'), password: z.string().min(1, 'Password is required') }),
  changePassword: z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6, 'Password must be at least 6 characters') }),
};

const org = {
  company: z.object({ name: str().min(2), legalName: optStr(), gstin, pan: optStr(10), email: optStr(), phone: optStr(20), website: optStr(), address, logoUrl: optStr(500) }),
  branch: z.object({ name: str(80).min(2), code: str(10).min(2).toUpperCase(), gstin, phone: optStr(20), email: optStr(), address, stateCode: optStr(5), managerName: optStr(), active: z.boolean().optional(), isDefault: z.boolean().optional() }),
  role: z.object({ name: str(60).min(2), code: optStr(60), description: optStr(), permissions: z.array(z.string()).default([]), allBranches: z.boolean().default(false), maxDiscountPercent: z.coerce.number().min(0).max(100).default(0) }),
  userCreate: z.object({
    name: str(80).min(2), username: str(40).min(3).toLowerCase().regex(/^[a-z0-9._-]+$/, 'Username may contain letters, numbers, . _ -'),
    email: optStr(), mobile: optStr(15), password: z.string().min(6, 'Password must be at least 6 characters'),
    roleId: id, branchIds: z.array(id).default([]), defaultBranchId: optId, active: z.boolean().default(true),
  }),
  userUpdate: z.object({
    name: str(80).min(2).optional(), email: optStr(), mobile: optStr(15), password: z.string().min(6).optional().or(z.literal('')).transform((v) => v || undefined),
    roleId: id.optional(), branchIds: z.array(id).optional(), defaultBranchId: optId, active: z.boolean().optional(),
  }),
};

const master = {
  category: z.object({ name: str(80).min(1), code: optStr(20), parentId: z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : v || null)), defaultGstRate: gst.optional(), defaultHsnCode: optStr(10), active: z.boolean().optional() }),
  brand: z.object({ name: str(80).min(1), description: optStr(), active: z.boolean().optional() }),
  supplier: z.object({
    name: str(120).min(2), code: optStr(20), contactPerson: optStr(), mobile: optStr(15), email: optStr(), gstin, address, stateCode: optStr(5),
    openingBalance: z.coerce.number().default(0), active: z.boolean().optional(),
  }),
  expenseCategory: z.object({ name: str(80).min(1), description: optStr(), active: z.boolean().optional() }),
};

const variant = z.object({
  _id: optId, size: optStr(20), color: optStr(40), fabric: optStr(40), pattern: optStr(40), style: optStr(40),
  sku: optStr(60), barcode: optStr(48), barcodeFormat: z.enum(['EAN13', 'CODE128']).optional(),
  purchasePrice: money.optional(), sellingPrice: money.optional(), mrp: money.optional(), reorderLevel: z.coerce.number().int().min(0).optional(),
  status: z.enum(['active', 'inactive']).optional(), openingStock: z.coerce.number().int().min(0).optional(),
});
const productBase = {
  productCode: optStr(30), name: str(150).min(2, 'Product name is required'), categoryId: id, subCategoryId: optId, brandId: optId,
  gender: z.enum(['Men', 'Women', 'Boys', 'Girls', 'Kids', 'Unisex', '']).optional(), season: optStr(40), hsnCode: optStr(10), gstRate: gst,
  unit: optStr(10), purchasePrice: money.default(0), sellingPrice: money, mrp: money, discountPercent: z.coerce.number().min(0).max(100).optional(),
  supplierId: optId, description: optStr(2000), images: z.array(z.string().max(500)).max(8).optional(), fabric: optStr(40), pattern: optStr(40), style: optStr(40),
  status: z.enum(['active', 'inactive']).optional(), variants: z.array(variant).min(1, 'At least one variant is required').max(300),
};
const product = {
  create: z.object({ ...productBase, productCode: str(30).min(1, 'Product code is required'), openingStockBranchId: optId }),
  update: z.object({ ...productBase, applyPricesToVariants: z.boolean().optional() }),
};

const barcode = {
  bulk: z.object({ variantIds: z.array(id).min(1).max(1000), format: z.enum(['EAN13', 'CODE128']).optional() }),
  labels: z.object({ items: z.array(z.object({ variantId: id, qty: z.coerce.number().int().min(1).max(500) })).min(1).max(2000) }),
  validate: z.object({ code: str(48).min(1), format: z.enum(['EAN13', 'CODE128']).optional(), variantId: optId }),
};

const lineItem = z.object({ variantId: id, qty, rate: money, discount: money.optional(), discountPercent: z.coerce.number().min(0).max(100).optional(), gstRate: gst.optional(), mrp: money.optional(), sellingPrice: money.optional() });

const purchase = {
  create: z.object({
    branchId: id, supplierId: id, invoiceNumber: str(40).min(1, 'Supplier invoice number is required'), invoiceDate: date,
    items: z.array(lineItem).min(1, 'Add at least one item').max(1000), billDiscount: money.optional(), notes: optStr(1000),
    status: z.enum(['draft', 'received']).default('draft'), updatePrices: z.boolean().optional(),
    payment: z.object({ amount: money, mode: z.enum(['cash', 'card', 'upi', 'bank']), reference: optStr(100) }).optional(),
  }),
  return: z.object({
    purchaseId: id, items: z.array(z.object({ purchaseItemId: id, qty: z.coerce.number().int().min(0) })).min(1),
    reason: str(300).min(2, 'Reason is required'), settlement: z.enum(['adjust', 'refund']).default('adjust'), refundMode: z.enum(['cash', 'card', 'upi', 'bank']).optional(),
  }),
  receive: z.object({ updatePrices: z.boolean().optional() }),
  supplierPayment: z.object({ supplierId: id, purchaseId: optId, amount: money.refine((v) => v > 0, 'Amount must be greater than zero'), mode: z.enum(['cash', 'card', 'upi', 'bank']), reference: optStr(100), notes: optStr(300) }),
};

const saleItem = z.object({ variantId: id, qty, rate: money.optional(), discount: money.optional(), discountPercent: z.coerce.number().min(0).max(100).optional() });
// POS bill lines: negative qty = item returned at the counter inside the bill
const saleQty = z.coerce.number().int('Quantity must be a whole number').min(-100000).max(100000).refine((n) => n !== 0, 'Quantity cannot be zero');
// saleItemId: this minus line returns that line of an earlier bill (price comes from that bill)
const billItem = saleItem.extend({ qty: saleQty, saleItemId: optId });
const sale = {
  create: z.object({
    customerId: optId, items: z.array(billItem).min(1, 'Add at least one item').max(500), billDiscount: money.optional(), payments, notes: optStr(500), heldBillId: optId,
    refundMode: z.enum(['cash', 'card', 'upi', 'bank', 'store_credit']).optional(), // when returns make the bill total negative
  }),
  edit: z.object({ customerId: z.union([id, z.literal(''), z.null()]).optional(), notes: optStr(500), payments: payments.optional() }),
  cancel: z.object({ reason: str(300).min(3, 'Cancellation reason is required') }),
  hold: z.object({ customerId: optId, items: z.array(z.any()).min(1, 'Nothing to hold').max(500), billDiscount: money.optional(), amount: z.coerce.number(), note: optStr(200) }),
  return: z.object({
    saleId: id, items: z.array(z.object({ saleItemId: id, qty: z.coerce.number().int().min(0) })).min(1),
    refundMode: z.enum(['cash', 'card', 'upi', 'bank', 'store_credit', 'adjust_outstanding']).default('cash'), reason: str(300).min(2, 'Return reason is required'),
  }),
  exchange: z.object({
    saleId: id, returnItems: z.array(z.object({ saleItemId: id, qty: z.coerce.number().int().min(0) })).min(1),
    newItems: z.array(saleItem).min(1, 'Select the exchange product'), billDiscount: money.optional(), payments: payments.default([]),
    refundMode: z.enum(['cash', 'card', 'upi', 'bank', 'store_credit']).optional(), reason: str(300).min(2, 'Reason is required'),
  }),
};

const customer = {
  upsert: z.object({
    name: str(100).min(2, 'Customer name is required'), mobile, email: z.string().trim().email('Invalid email').optional().or(z.literal('')), address: optStr(500),
    city: optStr(), state: optStr(), stateCode: optStr(5), dob: z.coerce.date().optional().or(z.literal('')).transform((v) => v || undefined),
    anniversary: z.coerce.date().optional().or(z.literal('')).transform((v) => v || undefined), gstNumber: gstin, notes: optStr(500), active: z.boolean().optional(),
  }),
  receipt: z.object({ customerId: id, amount: money.refine((v) => v > 0, 'Amount must be greater than zero'), mode: z.enum(['cash', 'card', 'upi', 'bank']), reference: optStr(100), notes: optStr(300) }),
  loyaltyAdjust: z.object({ customerId: id, points: z.coerce.number().int().refine((v) => v !== 0, 'Points cannot be zero'), note: str(200).min(2) }),
};

const stock = {
  adjustment: z.object({
    branchId: optId, type: z.enum(['damage', 'missing', 'found', 'correction', 'opening']), mode: z.enum(['delta', 'set']).default('delta'),
    reason: str(300).min(2, 'Reason is required'), items: z.array(z.object({ variantId: id, qty: z.coerce.number().int() })).min(1).max(1000),
  }),
  transfer: z.object({
    fromBranchId: id, toBranchId: id, notes: optStr(500), send: z.boolean().optional(),
    items: z.array(z.object({ variantId: id, qty })).min(1, 'Add at least one item').max(1000),
  }),
  receive: z.object({ items: z.array(z.object({ itemId: id, receivedQty: z.coerce.number().int().min(0) })).optional(), note: optStr(300) }),
  cancel: z.object({ reason: str(300).min(2, 'Reason is required') }),
};

const expense = {
  create: z.object({
    branchId: optId, categoryId: id, date, amount: money.refine((v) => v > 0, 'Amount must be greater than zero'),
    paymentMode: z.enum(['cash', 'bank', 'upi', 'card']), reference: optStr(100), paidTo: optStr(), notes: optStr(500),
  }),
};

const cash = {
  open: z.object({ openingCash: money, notes: optStr(300) }),
  movement: z.object({ type: z.enum(['in', 'out']), amount: money.refine((v) => v > 0, 'Amount must be greater than zero'), reason: str(200).min(2, 'Reason is required') }),
  close: z.object({ actualClosing: money, denominations: z.record(z.coerce.number()).optional(), notes: optStr(300) }),
};

module.exports = { id, auth, org, master, product, barcode, purchase, sale, customer, stock, expense, cash };
