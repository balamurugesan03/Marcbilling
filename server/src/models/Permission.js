const { Schema, model } = require('mongoose');

// Global permission catalogue (synchronised from constants/permissions.js at boot).
const permissionSchema = new Schema({
  key: { type: String, required: true, unique: true },
  group: { type: String, required: true },
  label: { type: String, required: true },
  action: { type: String, enum: ['view', 'create', 'edit', 'delete', 'other'], default: 'other' },
}, { timestamps: true });

module.exports = model('Permission', permissionSchema);
