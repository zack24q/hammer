const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { deferred } = require('./helpers/browser.cjs');
const api = require('../src/renderer/services/musicApi.ts');
let sequence = 0;
const song = (source = 'netease') => ({
  id: `test-${++sequence}`,
  name: 'Green',
  artist: ['A', 'B'],
  album: '',
  source,
  pic_id: 'cover',
  lyric_id: 'lyric',
});
function mockMetadata(t, overrides = {}) {
  const original = axios.get,
    calls = [];
  t.after(() => (axios.get = original));
  axios.get = async (_url, { params }) => {
    calls.push(params);
    if (overrides[params.types]) return overrides[params.types](params);
    return {
      data:
        params.types === 'url'
          ? { url: 'https://example.test/audio' }
          : params.types === 'pic'
            ? { url: 'https://example.test/cover' }
            : { lyric: '[00:01] Green' },
    };
  };
  return calls;
}
test('music metadata joins artists and caches all three resource requests', async t => {
  const calls = mockMetadata(t),
    input = song();
  const first = await api.getSongInfo(input),
    second = await api.getSongInfo(input);
  assert.equal(first, second);
  assert.equal(first.artist, 'A / B');
  assert.deepEqual(calls.map(p => p.types).sort(), ['lyric', 'pic', 'url']);
  assert.equal(calls.find(p => p.types === 'pic').id, 'cover');
  assert.equal(calls.find(p => p.types === 'lyric').id, 'lyric');
});
test('identical song IDs in different music sources have independent caches', async t => {
  const calls = mockMetadata(t),
    input = song();
  await api.getSongInfo(input);
  await api.getSongInfo({ ...input, source: 'kuwo' });
  assert.equal(calls.length, 6);
});
test('metadata cache expires at exactly thirty minutes', async t => {
  const calls = mockMetadata(t),
    input = song(),
    original = Date.now;
  let now = 1000;
  Date.now = () => now;
  t.after(() => (Date.now = original));
  await api.getSongInfo(input);
  now += 30 * 60000 - 1;
  await api.getSongInfo(input);
  assert.equal(calls.length, 3);
  now += 1;
  await api.getSongInfo(input);
  assert.equal(calls.length, 6);
});
test('a failed metadata request is retryable and cannot poison the cache', async t => {
  let failed = true;
  const calls = mockMetadata(t, {
    url: async () => {
      if (failed) throw Error('offline');
      return { data: { url: 'https://example.test/retry' } };
    },
  });
  const input = song();
  await assert.rejects(api.getSongInfo(input), /offline/);
  failed = false;
  assert.equal((await api.getSongInfo(input)).url, 'https://example.test/retry');
  assert.equal(calls.length, 6);
});
test('missing lyrics produce a playable song without lyrics', async t => {
  mockMetadata(t, { lyric: async () => ({ data: {} }) });
  const result = await api.getSongInfo({ ...song(), artist: 'Solo' });
  assert.equal(result.lrc, null);
  assert.equal(result.artist, 'Solo');
});
test('music resources are fetched concurrently rather than serially', async t => {
  const pending = deferred();
  const calls = mockMetadata(t, { url: () => pending.promise });
  const result = api.getSongInfo(song());
  assert.equal(calls.length, 3);
  pending.resolve({ data: { url: 'https://example.test/audio' } });
  await result;
});
test('playlist endpoints use form encoding and tolerate an empty public playlist result', async t => {
  const original = axios.post,
    calls = [];
  t.after(() => (axios.post = original));
  axios.post = async (url, body, options) => {
    calls.push({ url, body, options });
    return { data: body.startsWith('types=userlist') ? {} : { playlist: { id: 123, tracks: [] } } };
  };
  assert.deepEqual(await api.getUserPlaylists('123'), []);
  assert.deepEqual(await api.getPlaylistDetail('123'), { id: 123, tracks: [] });
  assert.equal(calls[0].body, 'types=userlist&uid=123');
  assert.match(calls[1].options.headers['Content-Type'], /application\/x-www-form-urlencoded/);
});
