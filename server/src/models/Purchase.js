const { Schema, model } = require('mongoose');
const { totalsSchema } = require('./shared');

const purchaseSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  purchaseNo: { type: String, required: true },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
  supplierName: String,
  invoiceNumber: { type: String, required: true, trim: true },
  invoiceDate: { type: Date, required: true },
  status: { type: String, enum: ['draft', 'received', 'cancelled'], default: 'draft' },
  interState: { type: Boolean, default: false },
  taxInclusive: { type: Boolean, default: false },
  totals: { type: totalsSchema, default: () => ({}) },
  itemCount: Number,
  paidAmount: { type: Number, default: 0 },
  returnedAmount: { type: Number, default: 0 },
  dueAmount: { type: Number, default: 0 },
  paymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
  notes: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  receivedAt: Date,
  cancelledAt: Date,
}, { timestamps: true });

purchaseSchema.index({ companyId: 1, purchaseNo: 1 }, { unique: true });
purchaseSchema.index({ companyId: 1, supplierId: 1, invoiceNumber: 1 }, { unique: true });
purchaseSchema.index({ companyId: 1, branchId: 1, createdAt: -1 });
purchaseSchema.index({ companyId: 1, invoiceDate: -1 });

module.exports = model('Purchase', purchaseSchema);
