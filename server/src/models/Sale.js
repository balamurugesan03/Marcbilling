const { Schema, model } = require('mongoose');
const { totalsSchema, paymentLineSchema } = require('./shared');

const saleSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  invoiceNumber: { type: String, required: true },
  invoiceDate: { type: Date, default: Date.now },
  saleType: { type: String, enum: ['sale', 'exchange'], default: 'sale' },
  exchangeId: { type: Schema.Types.ObjectId, ref: 'Exchange' },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  customer: { name: String, mobile: String, gstNumber: String, address: String, _id: false },
  cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  cashierName: String,
  itemCount: Number,
  totals: { type: totalsSchema, default: () => ({}) },
  interState: { type: Boolean, default: false },
  taxInclusive: { type: Boolean, default: true },
  withGst: { type: Boolean, default: true }, // false = billed "without GST" from the POS switch: no tax on the sold items
  payments: [paymentLineSchema],
  paidAmount: { type: Number, default: 0 }, // excluding credit
  creditAmount: { type: Number, default: 0 }, // on-account (customer outstanding)
  tenderedAmount: { type: Number, default: 0 },
  changeReturned: { type: Number, default: 0 },
  costTotal: { type: Number, default: 0 },
  loyaltyEarned: { type: Number, default: 0 },
  loyaltyRedeemed: { type: Number, default: 0 },
  returnedAmount: { type: Number, default: 0 },
  status: { type: String, enum: ['completed', 'cancelled'], default: 'completed' },
  returnStatus: { type: String, enum: ['none', 'partial', 'full'], default: 'none' },
  printCount: { type: Number, default: 0 },
  notes: String,
  cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: Date,
  cancelReason: String,
  cashSessionId: { type: Schema.Types.ObjectId, ref: 'CashSession' },
}, { timestamps: true });

saleSchema.index({ companyId: 1, branchId: 1, invoiceNumber: 1 }, { unique: true });
saleSchema.index({ companyId: 1, invoiceNumber: 1 });
saleSchema.index({ companyId: 1, branchId: 1, createdAt: -1 });
saleSchema.index({ companyId: 1, createdAt: -1 });
saleSchema.index({ companyId: 1, customerId: 1, createdAt: -1 });
saleSchema.index({ companyId: 1, cashierId: 1, createdAt: -1 });

module.exports = model('Sale', saleSchema);
