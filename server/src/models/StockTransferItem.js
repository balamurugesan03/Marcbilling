const { Schema, model } = require('mongoose');

const transferItemSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  transferId: { type: Schema.Types.ObjectId, ref: 'StockTransfer', required: true, index: true },
  variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: String,
  sku: String,
  barcode: String,
  size: String,
  color: String,
  qty: { type: Number, required: true, min: 1 },
  receivedQty: { type: Number, default: 0 },
  costPrice: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = model('StockTransferItem', transferItemSchema);
