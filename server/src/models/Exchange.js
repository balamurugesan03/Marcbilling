const { Schema, model } = require('mongoose');
const { paymentLineSchema } = require('./shared');

// An exchange = a SaleReturn (type exchange) of the old items + a new Sale (type exchange) of the issued items.
const exchangeSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  exchangeNo: { type: String, required: true },
  originalSaleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true },
  originalInvoice: String,
  returnId: { type: Schema.Types.ObjectId, ref: 'SaleReturn' },
  returnNo: String,
  newSaleId: { type: Schema.Types.ObjectId, ref: 'Sale' },
  newInvoice: String,
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  customerName: String,
  returnValue: Number,
  newValue: Number,
  difference: Number, // + customer pays, - refund / store credit
  settlement: { type: String, enum: ['collect', 'refund', 'store_credit', 'none'] },
  payments: [paymentLineSchema],
  reason: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdByName: String,
}, { timestamps: true });

exchangeSchema.index({ companyId: 1, exchangeNo: 1 }, { unique: true });
exchangeSchema.index({ companyId: 1, branchId: 1, createdAt: -1 });

module.exports = model('Exchange', exchangeSchema);
