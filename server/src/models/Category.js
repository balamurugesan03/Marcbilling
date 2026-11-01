const { Schema, model } = require('mongoose');

// A category with parentId is a sub-category.
const categorySchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, trim: true, uppercase: true },
  parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
  defaultGstRate: { type: Number, enum: [0, 5, 12, 18, 28], default: 5 },
  defaultHsnCode: String,
  isAccessory: { type: Boolean, default: false }, // accessories get their own barcode series (Settings → Barcode)
  active: { type: Boolean, default: true },
}, { timestamps: true });

categorySchema.index({ companyId: 1, parentId: 1, name: 1 }, { unique: true });

module.exports = model('Category', categorySchema);
