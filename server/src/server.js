const http = require('http');
const mongoose = require('mongoose');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const app = require('./app');
const socket = require('./socket');
const { Permission } = require('./models');
const { PERMISSIONS } = require('./constants/permissions');

async function syncPermissions() {
  await Permission.bulkWrite(PERMISSIONS.map((p) => ({ updateOne: { filter: { key: p.key }, update: { $set: p }, upsert: true } })));
  await Permission.deleteMany({ key: { $nin: PERMISSIONS.map((p) => p.key) } });
}

async function start() {
  await connectDB();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await syncPermissions();
  const server = http.createServer(app);
  socket.init(server);
  server.listen(env.port, () => console.log(`[server] MARC POS API listening on http://localhost:${env.port} (${env.nodeEnv})`));

  const shutdown = async (sig) => {
    console.log(`[server] ${sig} received, shutting down`);
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((e) => {
  console.error('[server] failed to start', e);
  process.exit(1);
});
