const { test } = require('node:test');
const assert = require('node:assert/strict');
const { livePageFixture } = require('./helpers/live-page.cjs');
const root = 'https://api.live.bilibili.com';
const permission = '/xlive/app-blink/v1/live/GetWebLivePermission';
const upstream = '/xlive/app-blink/v1/live/FetchWebUpStreamAddr';
const normalize = value => JSON.parse(JSON.stringify(value));

test('live helper installs only in the official live-center origin', async () => {
  let request;
  const native = async (input, init) => {
    request = { input, init };
    return Response.json({ code: 0, data: { allow_live: false } });
  };
  const { window, events } = livePageFixture(native, 'https://example.test');
  assert.equal(window.fetch, native);
  assert.deepEqual(events, []);
  await window.fetch(root + permission);
  assert.equal(request.input, root + permission);
});
test('permission response is changed only when the API itself reports success', async () => {
  for (const code of [0, 10022]) {
    const original = { code, data: { allow_live: false, fans_threshold: 5000, fixture: true } };
    const { window } = livePageFixture(async () => Response.json(original));
    const data = await (await window.fetch(root + permission)).json();
    assert.equal(data.code, code);
    assert.equal(data.data.fixture, true);
    assert.equal(data.data.allow_live, code === 0);
    assert.equal(data.data.fans_threshold, code === 0 ? 0 : 5000);
  }
});
test('stream responses publish credentials and map fields expected by the official webpage', async () => {
  let request;
  const { window, events } = livePageFixture(async (input, init) => {
    request = { input, init };
    return Response.json({
      code: 0,
      data: { rtmp: [{ addr: 'rtmp://example.test/live', code: 'fixture-key' }], stream_line: 2, fixture: true },
    });
  });
  const data = await (await window.fetch(`${root}${upstream}?room_id=123`)).json();
  assert.equal(new URL(request.input).pathname, '/live_stream/v1/StreamList/get_stream_by_roomId');
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.body, null);
  assert.deepEqual(normalize(events.find(e => e.type === 'credentials').data), {
    roomId: 123,
    server: 'rtmp://example.test/live',
    streamKey: 'fixture-key',
  });
  assert.equal(data.data.rtmp, undefined);
  assert.equal(data.data.addr[0].code, 'fixture-key');
  assert.equal(data.data.line, 2);
  assert.equal(data.data.fixture, true);
});
test('verification errors are preserved and published without emitting credentials', async () => {
  const payload = { code: 10022, message: '需要验证', data: { captcha_url: 'https://example.test/verify' } };
  const { window, events } = livePageFixture(async () => Response.json(payload));
  const data = await (
    await window.fetch(root + '/room/v1/Room/startLive', { method: 'POST', body: 'room_id=123&csrf=fixture' })
  ).json();
  assert.deepEqual(data, payload);
  assert.equal(
    events.some(e => e.type === 'credentials'),
    false
  );
  assert.match(events.find(e => e.type === 'error').message, /需要验证.*10022/);
});
test('invalid stream address or empty key cannot be published as credentials', async () => {
  for (const rtmp of [
    { addr: 'https://example.test/live', code: 'key' },
    { addr: 'rtmp://example.test/live', code: '' },
  ]) {
    const { window, events } = livePageFixture(async () => Response.json({ code: 0, data: { rtmp } }));
    await window.fetch(root + upstream + '?room_id=123');
    assert.equal(
      events.some(e => e.type === 'credentials'),
      false
    );
  }
});
test('successful stop clears captured stream credentials', async () => {
  const { window, events } = livePageFixture(async () => Response.json({ code: 0, data: {} }));
  await window.fetch(root + '/room/v1/Room/stopLive', { method: 'POST', body: 'room_id=123' });
  assert.equal(events.filter(e => e.type === 'clear').length, 1);
});
test('unrelated origins and non-JSON API responses retain their original Response', async () => {
  const response = new Response('fixture text', { status: 503 });
  const { window } = livePageFixture(async () => response);
  assert.equal(await window.fetch('https://example.test' + permission), response);
  assert.equal(await window.fetch(root + permission), response);
  assert.equal(await response.text(), 'fixture text');
});
test('XHR response interception works for both text and JSON and resets after reuse', () => {
  for (const type of ['', 'json']) {
    const { XHR, events } = livePageFixture(),
      xhr = new XHR();
    xhr.open('GET', root + permission);
    xhr.finish({ code: 0, data: { allow_live: false, fans_threshold: 5000 } }, type);
    const payload = type === 'json' ? xhr.response : JSON.parse(xhr.responseText);
    assert.equal(payload.data.allow_live, true);
    xhr.open('GET', root + upstream + '?room_id=321');
    xhr.send();
    xhr.finish({ code: 0, data: { rtmp: { addr: 'rtmps://example.test/live', code: 'fixture' } } }, type);
    assert.equal(events.find(e => e.type === 'credentials').data.roomId, 321);
    xhr.open('GET', 'https://example.test/unrelated');
    xhr.finish({ code: 0, data: { allow_live: false } }, type);
    const untouched = type === 'json' ? xhr.response : JSON.parse(xhr.responseText);
    assert.equal(untouched.data.allow_live, false);
  }
});
