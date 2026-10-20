const { Schema, model } = require('mongoose');

const expenseCategorySchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  name: { type: String, required: true, trim: true },
  description: String,
  active: { type: Boolean, default: true },
}, { timestamps: true });

expenseCategorySchema.index({ companyId: 1, name: 1 }, { unique: true });

module.exports = model('ExpenseCategory', expenseCategorySchema);
