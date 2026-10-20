const { Schema, model } = require('mongoose');

const userSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, lowercase: true, trim: true, unique: true },
  email: { type: String, lowercase: true, trim: true },
  mobile: { type: String, trim: true },
  passwordHash: { type: String, required: true, select: false },
  roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
  branchIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
  defaultBranchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
  active: { type: Boolean, default: true },
  lastLoginAt: Date,
  tokenVersion: { type: Number, default: 0 }, // bump to invalidate all sessions
}, { timestamps: true });

userSchema.index({ companyId: 1, roleId: 1 });

module.exports = model('User', userSchema);
