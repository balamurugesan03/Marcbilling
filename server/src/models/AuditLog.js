const { Schema, model } = require('mongoose');

const auditSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', index: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  userName: String,
  action: { type: String, required: true }, // e.g. sale.create, product.price_change
  entity: String,
  entityId: Schema.Types.ObjectId,
  refNo: String,
  oldValue: Schema.Types.Mixed,
  newValue: Schema.Types.Mixed,
  ip: String,
  userAgent: String,
}, { timestamps: { createdAt: true, updatedAt: false } });

auditSchema.index({ companyId: 1, createdAt: -1 });
auditSchema.index({ companyId: 1, action: 1, createdAt: -1 });
auditSchema.index({ companyId: 1, userId: 1, createdAt: -1 });
auditSchema.index({ entityId: 1 });

module.exports = model('AuditLog', auditSchema);
