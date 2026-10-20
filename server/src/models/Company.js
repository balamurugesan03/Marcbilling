const { Schema, model } = require('mongoose');

const addressSchema = new Schema({
  line1: String, line2: String, city: String, state: String, stateCode: String, pincode: String,
}, { _id: false });

const companySchema = new Schema({
  name: { type: String, required: true, trim: true },
  legalName: { type: String, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true, unique: true },
  gstin: { type: String, uppercase: true, trim: true },
  pan: { type: String, uppercase: true, trim: true },
  email: String,
  phone: String,
  website: String,
  address: addressSchema,
  logoUrl: String,
  currency: { type: String, default: 'INR' },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = model('Company', companySchema);
module.exports.addressSchema = addressSchema;
