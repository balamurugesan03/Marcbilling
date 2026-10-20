const { Schema, model } = require('mongoose');

const loyaltySchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
  type: { type: String, enum: ['earn', 'redeem', 'reverse', 'adjust'], required: true },
  points: { type: Number, required: true }, // signed
  balanceAfter: Number,
  refType: String,
  refId: Schema.Types.ObjectId,
  refNo: String,
  note: String,
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

loyaltySchema.index({ companyId: 1, customerId: 1, createdAt: -1 });

module.exports = model('LoyaltyTransaction', loyaltySchema);
