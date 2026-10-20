const { Schema, model } = require('mongoose');

const customerSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  code: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  mobile: { type: String, required: true, trim: true },
  email: { type: String, lowercase: true, trim: true },
  address: String,
  city: String,
  state: String,
  stateCode: String,
  dob: Date,
  anniversary: Date,
  gstNumber: { type: String, uppercase: true, trim: true },
  loyaltyPoints: { type: Number, default: 0 },
  outstanding: { type: Number, default: 0 }, // receivable (credit sales not yet collected)
  storeCredit: { type: Number, default: 0 }, // credit note balance from returns/exchanges
  totalPurchases: { type: Number, default: 0 },
  totalBills: { type: Number, default: 0 },
  totalReturns: { type: Number, default: 0 },
  lastPurchaseAt: Date,
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
  notes: String,
  active: { type: Boolean, default: true },
}, { timestamps: true });

customerSchema.index({ companyId: 1, mobile: 1 }, { unique: true });
customerSchema.index({ companyId: 1, code: 1 }, { unique: true });
customerSchema.index({ companyId: 1, name: 1 });

module.exports = model('Customer', customerSchema);
