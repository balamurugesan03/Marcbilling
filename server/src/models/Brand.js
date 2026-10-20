const { Schema, model } = require('mongoose');

const brandSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: String,
  active: { type: Boolean, default: true },
}, { timestamps: true });

brandSchema.index({ companyId: 1, name: 1 }, { unique: true });

module.exports = model('Brand', brandSchema);
