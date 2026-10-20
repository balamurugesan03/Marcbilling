const { Schema, model } = require('mongoose');

const roleSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, lowercase: true, trim: true },
  description: String,
  permissions: [{ type: String }],
  allBranches: { type: Boolean, default: false }, // company-wide access (Super/Company Admin, Accountant)
  maxDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },
  system: { type: Boolean, default: false },
}, { timestamps: true });

roleSchema.index({ companyId: 1, code: 1 }, { unique: true });

module.exports = model('Role', roleSchema);
