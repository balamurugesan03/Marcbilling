import { io } from 'socket.io-client';
import toast from 'react-hot-toast';

let socket = null;

const fire = (name, detail) => window.dispatchEvent(new CustomEvent(`fpos:${name}`, { detail }));

export function connectSocket(token, branchId) {
  if (socket) socket.disconnect();
  socket = io('/', { path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'] });
  socket.on('connect', () => socket.emit('branch:join', branchId));
  socket.on('sale:created', (d) => fire('sale', d));
  socket.on('sale:cancelled', (d) => fire('sale', d));
  socket.on('sale:returned', (d) => fire('sale', d));
  socket.on('stock:changed', (d) => fire('stock', d));
  socket.on('hold:changed', (d) => fire('hold', d));
  socket.on('transfer:incoming', (d) => {
    toast(`Incoming stock transfer ${d.transferNo} from ${d.from}`, { icon: '📦', duration: 6000 });
    fire('transfer', d);
  });
  socket.on('transfer:received', (d) => {
    toast.success(`Transfer ${d.transferNo} received at ${d.to}`);
    fire('transfer', d);
  });
  socket.on('company:sale:created', (d) => fire('company-sale', d));
  return socket;
}

export function joinBranch(branchId) {
  if (socket?.connected) socket.emit('branch:join', branchId);
}

export function disconnectSocket() {
  if (socket) socket.disconnect();
  socket = null;
}
