const { Schema, model } = require('mongoose');

// Each size/color/... combination is an independently trackable, sellable unit with its own SKU + barcode.
// Product fields needed at the billing counter are denormalised here so a scan is a single indexed lookup.
const variantSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  sku: { type: String, required: true, uppercase: true, trim: true },
  barcode: { type: String, required: true, trim: true },
  barcodeFormat: { type: String, enum: ['EAN13', 'CODE128'], default: 'EAN13' },
  size: { type: String, trim: true, default: '' },
  color: { type: String, trim: true, default: '' },
  fabric: String,
  pattern: String,
  style: String,
  purchasePrice: { type: Number, default: 0, min: 0 },
  sellingPrice: { type: Number, required: true, min: 0 },
  mrp: { type: Number, required: true, min: 0 },
  reorderLevel: { type: Number, default: 0 },
  // denormalised product fields
  productName: { type: String, required: true },
  productCode: String,
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
  categoryName: String,
  subCategoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
  brandId: { type: Schema.Types.ObjectId, ref: 'Brand' },
  brandName: String,
  gender: String,
  season: String,
  gstRate: { type: Number, enum: [0, 5, 12, 18, 28], required: true },
  hsnCode: String,
  unit: String,
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  searchText: { type: String, lowercase: true },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

variantSchema.index({ companyId: 1, barcode: 1 }, { unique: true });
variantSchema.index({ companyId: 1, sku: 1 }, { unique: true });
variantSchema.index({ companyId: 1, productCode: 1 });
variantSchema.index({ companyId: 1, deletedAt: 1, searchText: 1 });
variantSchema.index({ companyId: 1, categoryId: 1 });

variantSchema.statics.buildSearchText = (v) =>
  [v.productName, v.productCode, v.sku, v.barcode, v.size, v.color, v.brandName, v.categoryName].filter(Boolean).join(' ').toLowerCase();

module.exports = model('ProductVariant', variantSchema);
