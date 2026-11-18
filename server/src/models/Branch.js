const { Schema, model } = require('mongoose');
const { addressSchema } = require('./Company');

const branchSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  // one main branch per company; every other branch is a sub branch under it
  type: { type: String, enum: ['main', 'sub'], default: 'sub' },
  parentId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
  // company name printed on this branch's bills and barcode labels (empty = branch / company name)
  displayName: { type: String, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  gstin: { type: String, uppercase: true, trim: true },
  phone: String,
  email: String,
  address: addressSchema,
  stateCode: String,
  managerName: String,
  isDefault: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
}, { timestamps: true });

branchSchema.index({ companyId: 1, code: 1 }, { unique: true });
branchSchema.index({ companyId: 1, name: 1 }, { unique: true });

module.exports = model('Branch', branchSchema);
