const { Schema, model } = require('mongoose');

const MOVEMENT_TYPES = ['opening', 'purchase', 'purchase_return', 'sale', 'sale_return', 'transfer_in', 'transfer_out', 'adjustment', 'sale_cancel'];

// Immutable, auditable record of every stock movement.
const ledgerSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  type: { type: String, enum: MOVEMENT_TYPES, required: true },
  qty: { type: Number, required: true }, // signed: + in, - out
  balanceAfter: { type: Number, required: true },
  costPrice: Number,
  refType: String,
  refId: Schema.Types.ObjectId,
  refNo: String,
  note: String,
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: true, updatedAt: false } });

ledgerSchema.index({ branchId: 1, variantId: 1, createdAt: -1 });
ledgerSchema.index({ companyId: 1, createdAt: -1 });
ledgerSchema.index({ companyId: 1, type: 1, createdAt: -1 });
ledgerSchema.index({ refId: 1 });

module.exports = model('StockLedger', ledgerSchema);
module.exports.MOVEMENT_TYPES = MOVEMENT_TYPES;
