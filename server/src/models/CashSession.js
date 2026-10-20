const { Schema, model } = require('mongoose');

// Daily cashier till session. Cash payments/expenses created while open carry cashSessionId.
const cashSessionSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  sessionNo: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userName: String,
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  openedAt: { type: Date, default: Date.now },
  openingCash: { type: Number, required: true, min: 0 },
  movements: [{
    type: { type: String, enum: ['in', 'out'], required: true },
    amount: { type: Number, required: true, min: 0.01 },
    reason: String,
    at: { type: Date, default: Date.now },
    userId: Schema.Types.ObjectId,
    userName: String,
  }],
  summary: {
    cashSales: Number, cashReceipts: Number, cashRefunds: Number, cashExpenses: Number,
    supplierPayments: Number, cashIn: Number, cashOut: Number, expected: Number, _id: false,
  },
  closedAt: Date,
  actualClosing: Number,
  difference: Number,
  denominations: { type: Map, of: Number },
  closingNotes: String,
}, { timestamps: true });

cashSessionSchema.index({ companyId: 1, branchId: 1, userId: 1, status: 1 });
cashSessionSchema.index({ companyId: 1, branchId: 1, openedAt: -1 });

module.exports = model('CashSession', cashSessionSchema);
