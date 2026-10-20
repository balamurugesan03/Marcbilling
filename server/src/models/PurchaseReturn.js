const { Schema, model } = require('mongoose');
const { lineFields } = require('./shared');

const purchaseReturnSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  returnNo: { type: String, required: true },
  purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase', required: true },
  purchaseNo: String,
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
  supplierName: String,
  items: [new Schema({ purchaseItemId: { type: Schema.Types.ObjectId, ref: 'PurchaseItem' }, ...lineFields }, { _id: false })],
  totalQty: Number,
  taxable: Number,
  totalTax: Number,
  amount: Number,
  settlement: { type: String, enum: ['adjust', 'refund'], default: 'adjust' }, // adjust supplier payable or receive refund
  refundMode: String,
  reason: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

purchaseReturnSchema.index({ companyId: 1, returnNo: 1 }, { unique: true });
purchaseReturnSchema.index({ companyId: 1, branchId: 1, createdAt: -1 });

module.exports = model('PurchaseReturn', purchaseReturnSchema);
