const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deferred } = require('./helpers/browser.cjs');
const {
  parseSongCommand,
  getSkipSongAction,
  selectNextSong,
  resolveSongRequest,
  convertTrackToSong,
  createLatestSongLoader,
} = require('../src/renderer/services/songRequestLogic.ts');
const song = (id, requester) => ({
  id,
  requester,
  name: `Song ${id}`,
  artist: ['Artist'],
  album: '',
  source: 'netease',
});

test('danmaku parsing handles skip, empty commands and disabled prefixes', () => {
  const prefixes = { netease: '点歌', kuwo: '点k歌', tidal: '' };
  assert.deepEqual(parseSongCommand(' 切歌 \n', prefixes), { type: 'skip' });
  assert.deepEqual(parseSongCommand('点k歌  绿光 ', prefixes), { type: 'request', source: 'kuwo', keyword: '绿光' });
  for (const content of ['你好', '点歌', '点歌  ', '前面点歌绿光'])
    assert.equal(parseSongCommand(content, prefixes), null);
});

test('overlapping song prefixes select the most specific source', () => {
  assert.deepEqual(parseSongCommand('点歌酷我 绿光', { netease: '点歌', kuwo: '点歌酷我' }), {
    type: 'request',
    source: 'kuwo',
    keyword: '绿光',
  });
});

test('skip permissions distinguish broadcaster, moderator, owner and other users', () => {
  const current = song('current', 'Alice');
  for (const role of [100, 1])
    assert.deepEqual(getSkipSongAction(current, [], 'Bob', role), { type: 'skip', authorized: true });
  assert.deepEqual(getSkipSongAction(current, [], 'Alice', 0), { type: 'skip', authorized: false });
  assert.deepEqual(getSkipSongAction(current, [], 'Bob', 0), { type: 'ignore' });
});

test('skip respects system songs and removes only the first queued song for its owner', () => {
  const queue = [song('a', 'Alice'), song('b', 'Bob'), song('c', 'Bob')];
  assert.deepEqual(getSkipSongAction(song('system', '[系统]'), queue, '[系统]', 0), { type: 'ignore' });
  assert.deepEqual(getSkipSongAction(null, queue, 'Bob', 0), { type: 'remove', index: 1 });
  assert.deepEqual(getSkipSongAction(song('a', 'Alice'), queue, 'Bob', 0), { type: 'remove', index: 1 });
  assert.deepEqual(getSkipSongAction(null, [], 'Alice', 100), { type: 'ignore' });
});

test('next song prioritizes requests without mutating the queue or advancing the fixed playlist', () => {
  const queue = [song('q1'), song('q2')],
    playlist = [song('p1'), song('p2')];
  const next = selectNextSong(queue, playlist, 1);
  assert.equal(next.song, queue[0]);
  assert.deepEqual(next.requests, [queue[1]]);
  assert.equal(next.index, 1);
  assert.equal(next.fromDefault, false);
  assert.equal(queue.length, 2);
});

test('fixed playlist wraps, handles a single song, and repairs invalid indexes', () => {
  const playlist = [song('a'), song('b')];
  assert.equal(selectNextSong([], playlist, 0).song, playlist[1]);
  assert.equal(selectNextSong([], playlist, 1).song, playlist[0]);
  assert.equal(selectNextSong([], [playlist[0]], 0).index, 0);
  for (const index of [-1, 9, NaN, 0.5]) assert.equal(selectNextSong([], playlist, index).song, playlist[0]);
  assert.equal(selectNextSong([], [], 0).song, null);
});

test('blacklisted request keywords and requesters never call the search API', async () => {
  for (const [keyword, requester] of [
    ['blocked', 'Alice'],
    ['green', 'blocked'],
  ]) {
    const result = await resolveSongRequest(
      'netease',
      keyword,
      requester,
      () => assert.fail('must not search'),
      text => text === 'blocked'
    );
    assert.equal(result.song, null);
    assert.match(result.message, /已拦截黑名单/);
  }
});

test('search results are filtered by title and all artists before entering the queue', async () => {
  for (const candidate of [
    { ...song('a'), name: 'blocked' },
    { ...song('a'), artist: ['good', 'blocked'] },
  ]) {
    const result = await resolveSongRequest(
      'netease',
      'green',
      'Alice',
      async () => [candidate],
      text => text.includes('blocked')
    );
    assert.equal(result.song, null);
  }
  const candidate = song('a');
  const result = await resolveSongRequest(
    'netease',
    'green',
    'Alice',
    async (keyword, source) => {
      assert.equal(keyword, 'green');
      assert.equal(source, 'netease');
      return [candidate, song('b')];
    },
    () => false
  );
  assert.equal(result.song.id, 'a');
  assert.equal(result.song.requester, 'Alice');
  assert.equal(candidate.requester, undefined);
});

test('empty and failed song searches never fabricate a playable song', async () => {
  assert.equal(
    (
      await resolveSongRequest(
        'kuwo',
        'green',
        'Alice',
        async () => [],
        () => false
      )
    ).song,
    null
  );
  await assert.rejects(
    resolveSongRequest(
      'kuwo',
      'green',
      'Alice',
      async () => {
        throw Error('offline');
      },
      () => false
    ),
    /offline/
  );
});

test('playlist import preserves string cover IDs beyond JavaScript integer precision', () => {
  const track = {
    id: 123,
    name: 'green',
    ar: [{ name: 'A' }, { name: 'B' }],
    al: { name: 'album', pic: 123, pic_str: '109951166887388958' },
  };
  assert.deepEqual(convertTrackToSong(track), {
    id: '123',
    name: 'green',
    artist: ['A', 'B'],
    album: 'album',
    source: 'netease',
    pic_id: '109951166887388958',
    lyric_id: '123',
  });
  delete track.al.pic_str;
  assert.equal(convertTrackToSong(track).pic_id, '123');
});

test('a late song response cannot replace the newest playback or clear its loading state', async () => {
  const old = deferred(),
    latest = deferred(),
    events = [];
  const loader = createLatestSongLoader(input => (input.id === 'old' ? old.promise : latest.promise));
  const callbacks = {
    success: audio => events.push(audio.name),
    error: () => events.push('error'),
    finish: () => events.push('finish'),
  };
  const first = loader.load(song('old'), callbacks),
    second = loader.load(song('new'), callbacks);
  old.resolve({ name: 'old' });
  await first;
  assert.deepEqual(events, []);
  latest.resolve({ name: 'new' });
  await second;
  assert.deepEqual(events, ['new', 'finish']);
});

test('cancelled song failures cannot update a destroyed player', async () => {
  const pending = deferred(),
    events = [];
  const loader = createLatestSongLoader(() => pending.promise);
  const loading = loader.load(song('a'), {
    success: () => events.push('success'),
    error: () => events.push('error'),
    finish: () => events.push('finish'),
  });
  loader.cancel();
  pending.reject(Error('offline'));
  await loading;
  assert.deepEqual(events, []);
});

test('older success or failure arriving after the newest song cannot change playback', async () => {
  for (const failOldRequest of [false, true]) {
    const old = deferred(),
      latest = deferred(),
      events = [];
    const loader = createLatestSongLoader(input => (input.id === 'old' ? old.promise : latest.promise));
    const callbacks = {
      success: audio => events.push(audio.name),
      error: () => events.push('error'),
      finish: () => events.push('finish'),
    };
    const first = loader.load(song('old'), callbacks),
      second = loader.load(song('new'), callbacks);
    latest.resolve({ name: 'new' });
    await second;
    assert.deepEqual(events, ['new', 'finish']);
    if (failOldRequest) old.reject(Error('old offline'));
    else old.resolve({ name: 'old' });
    await first;
    assert.deepEqual(events, ['new', 'finish']);
  }
});

test('a current song failure ends loading and is reported exactly once', async () => {
  const events = [];
  const loader = createLatestSongLoader(async () => {
    throw Error('offline');
  });
  await loader.load(song('a'), {
    success: () => assert.fail('no audio'),
    error: error => events.push(error.message),
    finish: () => events.push('finish'),
  });
  assert.deepEqual(events, ['offline', 'finish']);
});
