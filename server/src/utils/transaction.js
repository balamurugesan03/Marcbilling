const mongoose = require('mongoose');
const { dbState } = require('../config/db');

/**
 * Runs `fn(session)` inside a MongoDB transaction; every write inside must pass `{ session }`.
 * withTransaction retries on transient errors (e.g. write conflicts between concurrent cashiers).
 * Without a replica set (dev only, warned at boot) fn runs with session = null.
 */
async function runInTransaction(fn) {
  if (!dbState.transactionsSupported) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { runInTransaction };
