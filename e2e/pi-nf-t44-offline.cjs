// Fixture process guard only. The T44 test uses loopback HTTP and local Git.
const net = process.getBuiltinModule('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0] : args;
  const options = first[0];
  const host = typeof options === 'object' ? options.host : typeof first[1] === 'string' ? first[1] : undefined;
  if (host && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('T44 fixture: non-loopback connection denied');
  return connect.apply(this, args);
};
