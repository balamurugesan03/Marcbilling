const { Schema, model } = require('mongoose');
const { lineFields } = require('./shared');

const purchaseItemSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase', required: true, index: true },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
  ...lineFields,
  mrp: Number,
  sellingPrice: Number,
  returnedQty: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'received', 'cancelled'], default: 'draft' },
  invoiceDate: Date,
}, { timestamps: true });

purchaseItemSchema.index({ companyId: 1, variantId: 1, createdAt: -1 });
purchaseItemSchema.index({ companyId: 1, supplierId: 1, createdAt: -1 });

module.exports = model('PurchaseItem', purchaseItemSchema);
