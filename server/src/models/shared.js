const { Schema } = require('mongoose');

const totalsSchema = new Schema({
  totalQty: { type: Number, default: 0 },
  subtotal: { type: Number, default: 0 },
  itemDiscount: { type: Number, default: 0 },
  billDiscount: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  taxable: { type: Number, default: 0 },
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  igst: { type: Number, default: 0 },
  totalTax: { type: Number, default: 0 },
  roundOff: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
}, { _id: false });

const PAYMENT_MODES = ['cash', 'card', 'upi', 'bank', 'credit', 'store_credit', 'loyalty', 'exchange'];

const paymentLineSchema = new Schema({
  mode: { type: String, enum: PAYMENT_MODES, required: true },
  amount: { type: Number, required: true },
  reference: String,
}, { _id: false });

// Line fields shared by sale / return / purchase items.
const lineFields = {
  variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: String,
  sku: String,
  barcode: String,
  size: String,
  color: String,
  hsnCode: String,
  qty: { type: Number, required: true, min: 1 },
  rate: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0 },
  gstRate: { type: Number, default: 0 },
  taxable: { type: Number, default: 0 },
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  igst: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
};

module.exports = { totalsSchema, paymentLineSchema, PAYMENT_MODES, lineFields };
