const mongoose = require('mongoose');
const env = require('./env');

const state = { transactionsSupported: false };

async function connectDB(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { maxPoolSize: 50 });
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    state.transactionsSupported = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    state.transactionsSupported = false;
  }
  if (!state.transactionsSupported) {
    const msg = 'MongoDB is not a replica set: multi-document transactions are DISABLED. Run `npm run db:dev` or configure a replica set.';
    if (env.requireTransactions) throw new Error(msg);
    console.warn(`[db] WARNING: ${msg}`);
  }
  console.log(`[db] connected ${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name} (transactions=${state.transactionsSupported})`);
}

module.exports = { connectDB, dbState: state };
