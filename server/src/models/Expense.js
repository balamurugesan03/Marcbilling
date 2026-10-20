const { Schema, model } = require('mongoose');

const expenseSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  expenseNo: { type: String, required: true },
  categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
  categoryName: String,
  date: { type: Date, required: true },
  amount: { type: Number, required: true, min: 0.01 },
  paymentMode: { type: String, enum: ['cash', 'bank', 'upi', 'card'], required: true },
  reference: String,
  paidTo: String,
  notes: String,
  status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  userName: String,
  cashSessionId: { type: Schema.Types.ObjectId, ref: 'CashSession' },
}, { timestamps: true });

expenseSchema.index({ companyId: 1, expenseNo: 1 }, { unique: true });
expenseSchema.index({ companyId: 1, branchId: 1, date: -1 });
expenseSchema.index({ cashSessionId: 1 });

module.exports = model('Expense', expenseSchema);
