/* Starts a local single-node MongoDB replica set (required for transactions) on port 27018. */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const port = process.env.MONGO_DEV_PORT || '27018';
const dbPath = path.resolve(__dirname, '../../.mongo-data');
fs.mkdirSync(dbPath, { recursive: true });

function findMongod() {
  if (process.env.MONGOD_PATH) return process.env.MONGOD_PATH;
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\MongoDB\\Server';
    if (fs.existsSync(base)) {
      for (const v of fs.readdirSync(base).sort().reverse()) {
        const p = path.join(base, v, 'bin', 'mongod.exe');
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return 'mongod';
}

const mongod = findMongod();
console.log(`[dev-mongo] starting ${mongod} on port ${port}, data=${dbPath}`);
const child = spawn(mongod, ['--replSet', 'rs0', '--port', port, '--bind_ip', '127.0.0.1', '--dbpath', dbPath], { stdio: ['ignore', 'ignore', 'inherit'] });

setTimeout(() => {
  try {
    const js = `try { rs.status().ok } catch (e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:${port}' }] }).ok }`;
    execSync(`mongosh --quiet --port ${port} --eval "${js}"`, { stdio: 'inherit' });
    console.log(`[dev-mongo] replica set rs0 ready: mongodb://127.0.0.1:${port}/fashion_pos?replicaSet=rs0`);
  } catch {
    console.error('[dev-mongo] could not initiate the replica set automatically. Open mongosh and run rs.initiate().');
  }
}, 3000);

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
