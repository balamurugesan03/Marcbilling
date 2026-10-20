const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

let io = null;

/** Real-time channel: rooms per company and per branch (dashboard refresh, stock, transfers, held bills). */
function init(httpServer) {
  io = new Server(httpServer, { cors: { origin: env.corsOrigins, credentials: true }, path: '/socket.io' });
  io.use((socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token, env.jwtAccessSecret);
      socket.data.companyId = payload.cid;
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`company:${socket.data.companyId}`);
    socket.join(`user:${socket.data.userId}`);
    socket.on('branch:join', (branchId) => {
      [...socket.rooms].filter((r) => r.startsWith('branch:')).forEach((r) => socket.leave(r));
      if (branchId && branchId !== 'all') socket.join(`branch:${branchId}`);
    });
  });
  return io;
}

function emit({ companyId, branchId, event, data }) {
  if (!io) return;
  if (branchId) io.to(`branch:${branchId}`).emit(event, data);
  io.to(`company:${companyId}`).emit(`company:${event}`, { ...data, branchId });
}

module.exports = { init, emit };
