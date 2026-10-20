const { Schema, model } = require('mongoose');

// Barcode registry: every code (primary or alternate) maps to exactly one variant; unique per company.
const barcodeSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  code: { type: String, required: true, trim: true },
  format: { type: String, enum: ['EAN13', 'CODE128'], required: true },
  variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true, index: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  isPrimary: { type: Boolean, default: true },
  source: { type: String, enum: ['auto', 'manual'], default: 'auto' },
  printedCount: { type: Number, default: 0 },
  lastPrintedAt: Date,
}, { timestamps: true });

barcodeSchema.index({ companyId: 1, code: 1 }, { unique: true });

module.exports = model('Barcode', barcodeSchema);
