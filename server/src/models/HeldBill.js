const { Schema, model } = require('mongoose');

const heldBillSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  holdNo: { type: String, required: true },
  cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  cashierName: String,
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  customerName: String,
  customerMobile: String,
  items: { type: Array, default: [] }, // cart snapshot
  billDiscount: { type: Number, default: 0 },
  itemCount: Number,
  amount: Number,
  note: String,
}, { timestamps: true });

heldBillSchema.index({ companyId: 1, branchId: 1, createdAt: -1 });

module.exports = model('HeldBill', heldBillSchema);
