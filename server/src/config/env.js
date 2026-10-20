const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/fashion_pos?replicaSet=rs0',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 7),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()),
  uploadDir: path.resolve(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads'),
  backupDir: path.resolve(__dirname, '../../', process.env.BACKUP_DIR || 'backups'),
  clientDist: path.resolve(__dirname, '../../../client/dist'),
  requireTransactions: process.env.REQUIRE_TRANSACTIONS === 'true',
};

if (env.nodeEnv === 'production' && env.jwtAccessSecret.startsWith('dev-')) {
  throw new Error('JWT secrets must be configured in production (JWT_ACCESS_SECRET / JWT_REFRESH_SECRET)');
}

module.exports = env;
