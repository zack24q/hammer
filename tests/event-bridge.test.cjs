const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const net = require('node:net');
const { WebSocket } = require('ws');
const { WebSocketServer } = require('../src/main/websocket.ts');

function createServer() {
  const server = new WebSocketServer();
  // Keep asynchronous application logs off the test runner's serialized stdout.
  // Protocol results and failures are asserted below; logging is not under test.
  server.log = () => {};
  return server;
}

function inbox(socket) {
  const queue = [],
    waiters = [];
  socket.on('message', body => {
    const data = JSON.parse(body.toString());
    if (waiters.length) waiters.shift()(data);
    else queue.push(data);
  });
  return {
    next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve))),
  };
}
async function fixture(t, token = '') {
  const server = createServer();
  t.after(() => server.stop());
  await server.start(0, '127.0.0.1', token);
  const address = server.wss.address(); // Read only to discover the OS-assigned test port.
  assert.ok(address?.port);
  const url = `ws://127.0.0.1:${address.port}`;
  const connect = async (role = 'client', password = token) => {
    const protocols = [`laplace-event-bridge-role-${role}`];
    if (password) protocols.push(password);
    const socket = new WebSocket(url, protocols),
      messages = inbox(socket);
    t.after(() => socket.terminate());
    const welcome = await messages.next();
    assert.equal(welcome.type, 'established');
    return { socket, messages, id: welcome.clientId, welcome };
  };
  return { server, address, url, connect };
}

test('event bridge start resolves only after the server is listening', async t => {
  const { connect } = await fixture(t);
  assert.equal((await connect()).welcome.isServer, false);
});
test('event bridge rejects occupied ports and permits retry without an uncaught server error', async t => {
  const occupied = net.createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const server = createServer();
  t.after(() => server.stop());
  await assert.rejects(server.start(occupied.address().port, '127.0.0.1'), { code: 'EADDRINUSE' });
  await server.start(0, '127.0.0.1');
  assert.ok(server.wss.address().port);
});
test('event bridge refuses duplicate starts without losing the original server', async t => {
  const { server, address, connect } = await fixture(t);
  await assert.rejects(server.start(0, '127.0.0.1'), /已启动/);
  assert.equal(server.wss.address().port, address.port);
  await connect();
});
test('event bridge authenticates valid clients and closes invalid tokens with policy code 1008', async t => {
  const { connect, url } = await fixture(t, 'fixture-token');
  assert.equal((await connect('server')).welcome.isServer, true);
  const bad = new WebSocket(url, ['laplace-event-bridge-role-client', 'wrong-token']);
  t.after(() => bad.terminate());
  const [code, reason] = await once(bad, 'close');
  assert.equal(code, 1008);
  assert.equal(reason.toString(), 'Unauthorized');
});
test('producer messages reach every other peer, retain payload, and cannot spoof source identity', async t => {
  const { connect } = await fixture(t);
  const producer = await connect('server'),
    consumer = await connect(),
    otherProducer = await connect('server');
  producer.socket.send(
    JSON.stringify({
      type: 'message',
      message: 'fixture text',
      username: 'Alice',
      source: 'spoofed',
      metadata: { a: 1 },
    })
  );
  const received = await consumer.messages.next(),
    other = await otherProducer.messages.next(),
    ack = await producer.messages.next();
  assert.deepEqual(received, other);
  assert.equal(received.source, producer.id);
  assert.deepEqual(received.metadata, { a: 1 });
  assert.equal(received.message, 'fixture text');
  assert.equal(ack.type, 'broadcast-success');
  assert.equal(ack.clientCount, 2);
});
test('consumer messages receive acknowledgments but are never relayed as danmaku', async t => {
  const { connect } = await fixture(t);
  const producer = await connect('server'),
    first = await connect(),
    second = await connect();
  first.socket.send(JSON.stringify({ type: 'message', message: 'must not relay' }));
  assert.equal((await first.messages.next()).type, 'client-message-received');
  // A producer marker is an ordering barrier, avoiding sleeps to assert absence.
  producer.socket.send(JSON.stringify({ type: 'fixture-marker' }));
  assert.equal((await second.messages.next()).type, 'fixture-marker');
  assert.equal((await producer.messages.next()).type, 'broadcast-success');
});
test('non-JSON producer payloads are forwarded as unknown messages with origin and timestamp', async t => {
  const { connect } = await fixture(t),
    producer = await connect('server'),
    consumer = await connect();
  producer.socket.send('plain fixture text');
  const message = await consumer.messages.next();
  assert.equal(message.type, 'unknown-message');
  assert.equal(message.text, 'plain fixture text');
  assert.equal(message.source, producer.id);
  assert.equal(typeof message.timestamp, 'number');
  await producer.messages.next();
});
test('event bridge stop is idempotent, closes active peers and allows restart', async t => {
  const { server, connect } = await fixture(t),
    peer = await connect();
  const closed = once(peer.socket, 'close');
  await Promise.all([server.stop(), server.stop()]);
  await closed;
  await server.stop();
  await server.start(0, '127.0.0.1');
  assert.ok(server.wss.address().port);
});
test(
  'event bridge shutdown is bounded when a raw peer never acknowledges the close frame',
  { timeout: 3000 },
  async t => {
    const { server, address } = await fixture(t);
    const peer = net.connect(address.port, '127.0.0.1');
    t.after(() => peer.destroy());
    await once(peer, 'connect');
    peer.write(
      'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
    );
    assert.match((await once(peer, 'data'))[0].toString(), /101 Switching Protocols/);
    const closed = once(peer, 'close');
    peer.resume();
    await server.stop();
    await closed;
  }
);
