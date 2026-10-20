const { Schema, model } = require('mongoose');
const { addressSchema } = require('./Company');

const supplierSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, trim: true, uppercase: true },
  contactPerson: String,
  mobile: { type: String, trim: true },
  email: String,
  gstin: { type: String, uppercase: true, trim: true },
  address: addressSchema,
  stateCode: String,
  openingBalance: { type: Number, default: 0 },
  balance: { type: Number, default: 0 }, // amount payable to supplier
  active: { type: Boolean, default: true },
}, { timestamps: true });

supplierSchema.index({ companyId: 1, name: 1 }, { unique: true });
supplierSchema.index({ companyId: 1, mobile: 1 });

module.exports = model('Supplier', supplierSchema);
