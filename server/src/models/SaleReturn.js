const { Schema, model } = require('mongoose');
const { lineFields, paymentLineSchema } = require('./shared');

const saleReturnSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  returnNo: { type: String, required: true },
  type: { type: String, enum: ['return', 'exchange'], default: 'return' },
  exchangeId: { type: Schema.Types.ObjectId, ref: 'Exchange' },
  saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true, index: true },
  invoiceNumber: String,
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  customerName: String,
  items: [new Schema({
    saleItemId: { type: Schema.Types.ObjectId, ref: 'SaleItem', required: true },
    ...lineFields,
    categoryName: String,
    brandName: String,
    costPrice: Number,
  }, { _id: false })],
  totalQty: Number,
  taxable: Number,
  cgst: Number,
  sgst: Number,
  igst: Number,
  totalTax: Number,
  costTotal: Number,
  amount: Number, // value of returned goods
  roundOff: Number,
  refundAmount: Number,
  refundMode: { type: String, enum: ['cash', 'card', 'upi', 'bank', 'store_credit', 'adjust_outstanding', 'exchange'], default: 'cash' },
  refunds: [paymentLineSchema],
  loyaltyReversed: { type: Number, default: 0 },
  reason: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdByName: String,
  cashSessionId: { type: Schema.Types.ObjectId, ref: 'CashSession' },
}, { timestamps: true });

saleReturnSchema.index({ companyId: 1, returnNo: 1 }, { unique: true });
saleReturnSchema.index({ companyId: 1, branchId: 1, createdAt: -1 });
saleReturnSchema.index({ companyId: 1, customerId: 1 });

module.exports = model('SaleReturn', saleReturnSchema);
