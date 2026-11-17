const { Schema, model } = require('mongoose');
const { lineFields } = require('./shared');

// One row per invoice line; denormalised for fast aggregation reports (product/category/brand/size/color/cashier-wise).
const saleItemSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true, index: true },
  invoiceNumber: String,
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  cashierId: { type: Schema.Types.ObjectId, ref: 'User' },
  ...lineFields,
  // negative qty = item returned at the counter inside this bill (stock comes back, amount is minus)
  qty: { type: Number, required: true, validate: { validator: (v) => Number.isInteger(v) && v !== 0, message: 'Quantity cannot be zero' } },
  mrp: Number,
  originalRate: Number, // variant selling price at the time of sale
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
  categoryName: String,
  brandId: { type: Schema.Types.ObjectId, ref: 'Brand' },
  brandName: String,
  costPrice: { type: Number, default: 0 },
  returnedQty: { type: Number, default: 0 },
  status: { type: String, enum: ['completed', 'cancelled'], default: 'completed' },
}, { timestamps: true });

saleItemSchema.index({ companyId: 1, createdAt: -1 });
saleItemSchema.index({ companyId: 1, branchId: 1, createdAt: -1 });
saleItemSchema.index({ companyId: 1, variantId: 1, createdAt: -1 });
saleItemSchema.index({ companyId: 1, productId: 1 });

module.exports = model('SaleItem', saleItemSchema);
