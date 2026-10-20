const { Schema, model } = require('mongoose');

const productSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  productCode: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  subCategoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
  brandId: { type: Schema.Types.ObjectId, ref: 'Brand' },
  gender: { type: String, enum: ['Men', 'Women', 'Boys', 'Girls', 'Kids', 'Unisex', ''], default: 'Unisex' },
  season: { type: String, default: 'All Season' },
  hsnCode: { type: String, trim: true },
  gstRate: { type: Number, enum: [0, 5, 12, 18, 28], required: true },
  unit: { type: String, default: 'PCS' },
  purchasePrice: { type: Number, default: 0, min: 0 },
  sellingPrice: { type: Number, required: true, min: 0 },
  mrp: { type: Number, required: true, min: 0 },
  discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
  description: String,
  images: [String],
  fabric: String,
  pattern: String,
  style: String,
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  variantCount: { type: Number, default: 0 },
  searchText: { type: String, select: false },
  deletedAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

productSchema.index({ companyId: 1, productCode: 1 }, { unique: true });
productSchema.index({ companyId: 1, deletedAt: 1, createdAt: -1 });
productSchema.index({ companyId: 1, categoryId: 1 });
productSchema.index({ companyId: 1, brandId: 1 });

module.exports = model('Product', productSchema);
