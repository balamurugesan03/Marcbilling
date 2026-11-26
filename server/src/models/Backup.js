const { Schema, model } = require('mongoose');

const backupSchema = new Schema({
  fileName: { type: String, required: true, unique: true },
  size: Number,
  collections: Number,
  documents: Number,
  type: { type: String, enum: ['manual', 'uploaded', 'pre_restore', 'pre_delete'], default: 'manual' },
  status: { type: String, enum: ['completed', 'failed'], default: 'completed' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdByName: String,
  restoredAt: Date,
  restoredByName: String,
  notes: String,
}, { timestamps: true });

module.exports = model('Backup', backupSchema);
