const { Schema, model } = require('mongoose');

const transferSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  transferNo: { type: String, required: true },
  fromBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  toBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  status: { type: String, enum: ['draft', 'sent', 'received', 'cancelled'], default: 'draft' },
  totalItems: { type: Number, default: 0 },
  totalQty: { type: Number, default: 0 },
  totalValue: { type: Number, default: 0 },
  notes: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  sentBy: { type: Schema.Types.ObjectId, ref: 'User' },
  sentAt: Date,
  receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  receivedAt: Date,
  cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: Date,
  cancelReason: String,
  history: [{ status: String, at: Date, userId: Schema.Types.ObjectId, userName: String, note: String, _id: false }],
}, { timestamps: true });

transferSchema.index({ companyId: 1, transferNo: 1 }, { unique: true });
transferSchema.index({ companyId: 1, fromBranchId: 1, createdAt: -1 });
transferSchema.index({ companyId: 1, toBranchId: 1, createdAt: -1 });
transferSchema.index({ companyId: 1, status: 1 });

module.exports = model('StockTransfer', transferSchema);
