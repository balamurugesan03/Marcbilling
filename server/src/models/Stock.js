const { Schema, model } = require('mongoose');

// Branch-wise, variant-wise stock summary. Only stock.service mutates it (always together with a StockLedger entry).
// current = opening + purchased + transferIn + salesReturned - sold - purchaseReturned - transferOut + adjustment
const stockSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  opening: { type: Number, default: 0 },
  purchased: { type: Number, default: 0 },
  purchaseReturned: { type: Number, default: 0 },
  sold: { type: Number, default: 0 },
  salesReturned: { type: Number, default: 0 },
  transferIn: { type: Number, default: 0 },
  transferOut: { type: Number, default: 0 },
  adjustment: { type: Number, default: 0 },
  current: { type: Number, default: 0 },
  avgCost: { type: Number, default: 0 },
  lastSoldAt: Date,
  lastMovementAt: Date,
}, { timestamps: true });

stockSchema.index({ branchId: 1, variantId: 1 }, { unique: true });
stockSchema.index({ companyId: 1, variantId: 1 });
stockSchema.index({ companyId: 1, branchId: 1, current: 1 });
stockSchema.index({ companyId: 1, productId: 1 });

module.exports = model('Stock', stockSchema);
