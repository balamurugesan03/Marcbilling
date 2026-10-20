const { Schema, model } = require('mongoose');

const adjustmentSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  adjustmentNo: { type: String, required: true },
  type: { type: String, enum: ['damage', 'missing', 'found', 'correction', 'opening'], required: true },
  items: [{
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    productName: String, sku: String, barcode: String, size: String, color: String,
    qty: { type: Number, required: true }, // signed
    beforeQty: Number,
    afterQty: Number,
    costPrice: Number,
    _id: false,
  }],
  totalQty: Number,
  totalValue: Number,
  reason: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  userName: String,
}, { timestamps: true });

adjustmentSchema.index({ companyId: 1, adjustmentNo: 1 }, { unique: true });
adjustmentSchema.index({ companyId: 1, branchId: 1, createdAt: -1 });

module.exports = model('StockAdjustment', adjustmentSchema);
