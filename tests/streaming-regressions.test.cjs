const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { WebSocketServer } = require('ws');
const { OBSWebSocket } = require('obs-websocket-js/json');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');
const { livePageFixture } = require('./helpers/live-page.cjs');
const { configureOBSStreamConnection } = require('../src/renderer/services/obsStreaming.ts');

test('XHR start rewrites content type once, preserves other headers and resets hooks on reuse', () => {
  const { XHR } = livePageFixture();
  for (const contentType of ['application/json', 'application/x-www-form-urlencoded', null]) {
    const xhr = new XHR();
    xhr.open('POST', 'https://api.live.bilibili.com/xlive/app-blink/v1/streaming/WebLiveCenterStartLive');
    if (contentType) xhr.setRequestHeader('cOnTeNt-TyPe', contentType);
    xhr.setRequestHeader('X-Test', 'keep');
    xhr.send(JSON.stringify({ room_id: 123, csrf: 'test-csrf', area_v2: 1 }));
    assert.equal(xhr.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(xhr.headers['x-test'], 'keep');
    assert.equal(new URL(xhr.url).pathname, '/room/v1/Room/startLive');
    assert.equal(xhr.body.get('room_id'), '123');
    assert.equal(xhr.body.get('csrf'), 'test-csrf');
    assert.equal(xhr.body.get('sign'), 'test-sign');

    xhr.open('POST', 'https://api.live.bilibili.com/unrelated');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send('{"keep":true}');
    assert.equal(xhr.headers['content-type'], 'application/json');
    assert.equal(xhr.body, '{"keep":true}');
  }
});

test('XHR upstream lookup uses the room ID in the POST body and preserves request headers', () => {
  const { XHR } = livePageFixture();
  const xhr = new XHR();
  xhr.open('POST', 'https://api.live.bilibili.com/xlive/app-blink/v1/live/FetchWebUpStreamAddr');
  xhr.setRequestHeader('X-Test', 'keep');
  xhr.send('room_id=456');
  assert.equal(xhr.method, 'GET');
  assert.equal(new URL(xhr.url).pathname, '/live_stream/v1/StreamList/get_stream_by_roomId');
  assert.equal(new URL(xhr.url).searchParams.get('room_id'), '456');
  assert.equal(xhr.headers['x-test'], 'keep');
  assert.equal(xhr.body, null);

  xhr.open('POST', 'https://api.live.bilibili.com/xlive/app-blink/v1/live/FetchWebUpStreamAddr');
  xhr.send('room_id=789');
  assert.equal(new URL(xhr.url).searchParams.get('room_id'), '789');
});

test('Fetch start preserves extra headers while replacing the content type', async () => {
  let captured;
  const { window } = livePageFixture(async (input, init) => {
    captured = { input, init };
    return new Response('{"code":0,"data":{}}');
  });
  await window.fetch(
    new Request('https://api.live.bilibili.com/xlive/app-blink/v1/streaming/WebLiveCenterStartLive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test': 'keep' },
      body: '{"room_id":123,"csrf":"test-csrf","area_v2":1}',
    })
  );
  assert.equal(new Headers(captured.init.headers).get('x-test'), 'keep');
  assert.equal(new Headers(captured.init.headers).get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(captured.init.body.get('room_id'), '123');
});

test('the actual streaming webview JSX renders allowpopups into the DOM', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/components/StreamingControls.tsx'), 'utf8');
  const ast = ts.createSourceFile('StreamingControls.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let webview;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'webview') webview = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(webview);
  const { outputText } = ts.transpileModule(`module.exports = (${webview.getText(ast)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ESNext },
  });
  const context = {
    React,
    module: { exports: {} },
    webviewRef: { current: null },
    preload: 'file:///test/preload.js',
    BILIBILI_LIVE_PAGE: 'https://link.bilibili.com/p/center/index#/my-room/start-live',
  };
  vm.runInNewContext(outputText, context);
  assert.match(renderToStaticMarkup(context.module.exports), /allowpopups="true"/);
});

async function obsServer(t, onRequest, sendHello = true) {
  const requests = [];
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  server.on('connection', socket => {
    if (sendHello) socket.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1 } }));
    socket.on('message', body => {
      const message = JSON.parse(body);
      if (message.op === 1) socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      if (message.op === 6) {
        requests.push(message.d);
        onRequest(socket, message.d);
      }
    });
  });
  return { url: `ws://127.0.0.1:${server.address().port}`, requests };
}

function reply(socket, request, responseData) {
  socket.send(
    JSON.stringify({
      op: 7,
      d: { requestId: request.requestId, requestStatus: { result: true, code: 100 }, responseData },
    })
  );
}

test('OBS config writes credentials without starting a stream and closes its temporary connection', async t => {
  const { url, requests } = await obsServer(t, (socket, request) =>
    reply(socket, request, request.requestType === 'GetStreamStatus' ? { outputActive: false } : {})
  );
  const obs = new OBSWebSocket();
  await configureOBSStreamConnection(obs, url, undefined, 'rtmp://example.test/live', 'test-key', 1000);
  assert.deepEqual(
    requests.map(request => request.requestType),
    ['GetStreamStatus', 'SetStreamServiceSettings']
  );
  assert.deepEqual(requests[1].requestData, {
    streamServiceType: 'rtmp_custom',
    streamServiceSettings: { server: 'rtmp://example.test/live', key: 'test-key', use_auth: false },
  });
  assert.equal(obs.identified, false);
  assert.equal(obs.listenerCount('ConnectionClosed'), 0);
  assert.equal(obs.listenerCount('ConnectionError'), 0);
});

test('OBS disconnect during GetStreamStatus rejects promptly instead of locking the dialog', async t => {
  const { url } = await obsServer(t, socket => socket.close());
  await assert.rejects(
    configureOBSStreamConnection(new OBSWebSocket(), url, undefined, 'rtmp://example.test/live', 'test-key', 1000),
    /OBS连接已断开/
  );
});

test('OBS handshake without Hello times out and releases the connection', async t => {
  const { url } = await obsServer(t, () => {}, false);
  const obs = new OBSWebSocket();
  await assert.rejects(
    configureOBSStreamConnection(obs, url, undefined, 'rtmp://example.test/live', 'test-key', 50),
    /OBS设置超时/
  );
  assert.equal(obs.identified, false);
});

test('OBS already streaming is rejected without overwriting settings', async t => {
  const { url, requests } = await obsServer(t, (socket, request) => reply(socket, request, { outputActive: true }));
  await assert.rejects(
    configureOBSStreamConnection(new OBSWebSocket(), url, undefined, 'rtmp://example.test/live', 'test-key', 1000),
    /OBS正在推流/
  );
  assert.deepEqual(
    requests.map(request => request.requestType),
    ['GetStreamStatus']
  );
});

test('a late status response after timeout cannot write stream settings', async () => {
  const obs = new EventEmitter();
  const requests = [];
  let resolveStatus;
  obs.connect = async () => {};
  obs.disconnect = async () => {};
  obs.call = async type => {
    requests.push(type);
    return new Promise(resolve => {
      resolveStatus = resolve;
    });
  };
  await assert.rejects(
    configureOBSStreamConnection(obs, 'ws://example.test', undefined, 'rtmp://example.test/live', 'test-key', 10),
    /OBS设置超时/
  );
  resolveStatus({ outputActive: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, ['GetStreamStatus']);
});

test('cancelling an OBS operation rejects promptly and prevents a late write', async () => {
  const obs = new EventEmitter();
  const requests = [];
  let resolveStatus;
  obs.connect = async () => {};
  obs.disconnect = async () => {};
  obs.call = async type => {
    requests.push(type);
    return new Promise(resolve => {
      resolveStatus = resolve;
    });
  };
  const controller = new AbortController();
  const operation = configureOBSStreamConnection(
    obs,
    'ws://example.test',
    undefined,
    'rtmp://example.test/live',
    'test-key',
    1000,
    controller.signal
  );
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error('account changed'));
  await assert.rejects(operation, /account changed/);
  resolveStatus({ outputActive: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, ['GetStreamStatus']);
  assert.equal(obs.listenerCount('ConnectionClosed'), 0);
  assert.equal(obs.listenerCount('ConnectionError'), 0);
});

test('an already cancelled OBS operation never opens a connection', async () => {
  const controller = new AbortController();
  controller.abort(new Error('page closed'));
  await assert.rejects(
    configureOBSStreamConnection(
      {
        connect() {
          assert.fail('must not connect');
        },
      },
      'ws://example.test',
      undefined,
      'rtmp://example.test/live',
      'test-key',
      1000,
      controller.signal
    ),
    /page closed/
  );
});
