const { Schema, model } = require('mongoose');
const { PAYMENT_MODES } = require('./shared');

// Every money movement (in / out) — feeds the cash book, payment summary and cash sessions.
const PAYMENT_TYPES = ['sale', 'sale_refund', 'sale_cancel', 'customer_receipt', 'supplier_payment', 'supplier_refund'];

const paymentSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  paymentNo: { type: String, required: true },
  date: { type: Date, default: Date.now },
  direction: { type: String, enum: ['in', 'out'], required: true },
  type: { type: String, enum: PAYMENT_TYPES, required: true },
  mode: { type: String, enum: PAYMENT_MODES, required: true },
  amount: { type: Number, required: true, min: 0 },
  reference: String,
  partyType: { type: String, enum: ['customer', 'supplier', 'none'], default: 'none' },
  partyId: Schema.Types.ObjectId,
  partyName: String,
  refType: String,
  refId: Schema.Types.ObjectId,
  refNo: String,
  notes: String,
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  userName: String,
  cashSessionId: { type: Schema.Types.ObjectId, ref: 'CashSession' },
}, { timestamps: true });

paymentSchema.index({ companyId: 1, paymentNo: 1 }, { unique: true });
paymentSchema.index({ companyId: 1, branchId: 1, date: -1 });
paymentSchema.index({ companyId: 1, partyId: 1, date: -1 });
paymentSchema.index({ cashSessionId: 1 });
paymentSchema.index({ refId: 1 });

module.exports = model('Payment', paymentSchema);
module.exports.PAYMENT_TYPES = PAYMENT_TYPES;
