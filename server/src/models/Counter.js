const { Schema, model } = require('mongoose');

// Atomic sequence counters for number series (invoice, purchase, transfer, barcode...).
const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

module.exports = model('Counter', counterSchema);
