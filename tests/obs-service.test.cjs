const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installBrowser } = require('./helpers/browser.cjs');
installBrowser();
const { OBSWebSocketService } = require('../src/renderer/services/obsWebSocket.ts');

function fixture(responses = {}) {
  const obs = new EventEmitter(),
    calls = [],
    connects = [];
  obs.connect = async (...args) => connects.push(args);
  obs.disconnect = async () => obs.emit('ConnectionClosed');
  obs.call = async (type, data) => {
    calls.push({ type, data });
    const response = responses[type];
    if (typeof response === 'function') return response(data);
    return (
      response ??
      ({
        GetCurrentProgramScene: { currentProgramSceneName: 'Fixture scene' },
        GetSceneItemList: { sceneItems: [] },
        GetInputKindList: { inputKinds: ['text_ft2_source'] },
      }[type] ||
        {})
    );
  };
  return { service: new OBSWebSocketService(obs), obs, calls, connects };
}

test('OBS connection reuses an established socket and reconnects after closure', async () => {
  const { service, obs, connects } = fixture();
  service.setConfig({ address: '127.0.0.1', port: 4455, password: 'fixture' });
  const listeners = await service.connect();
  await service.connect();
  assert.equal(connects.length, 1);
  assert.deepEqual(connects[0], ['ws://127.0.0.1:4455', 'fixture']);
  assert.equal(service.isConnectedToOBS(), true);
  let event = false;
  listeners.once('FixtureEvent', () => (event = true));
  obs.emit('FixtureEvent');
  assert.equal(event, true);
  await service.disconnect();
  assert.equal(service.isConnectedToOBS(), false);
  await service.connect();
  assert.equal(connects.length, 2);
});
test('failed OBS connection does not mark the service as connected and can be retried', async () => {
  const { service, obs } = fixture();
  obs.connect = async () => {
    throw Error('bad password');
  };
  await assert.rejects(service.connect(), /bad password/);
  assert.equal(service.isConnectedToOBS(), false);
  obs.connect = async () => {};
  await service.connect();
  assert.equal(service.isConnectedToOBS(), true);
});
test('existing OBS text source is enabled without creating duplicates', async () => {
  const { service, calls } = fixture({
    GetSceneItemList: { sceneItems: [{ sourceName: '锤子播放状态', sceneItemId: 42 }] },
  });
  assert.equal(await service.configureSongRequestSource(), true);
  assert.equal(
    calls.some(c => c.type === 'CreateInput'),
    false
  );
  assert.deepEqual(calls.find(c => c.type === 'SetSceneItemEnabled').data, {
    sceneName: 'Fixture scene',
    sceneItemId: 42,
    sceneItemEnabled: true,
  });
});
for (const [name, kinds, expected] of [
  ['Windows', ['text_ft2_source', 'text_gdiplus'], 'text_gdiplus'],
  ['macOS', ['text_ft2_source'], 'text_ft2_source'],
  ['fallback', ['image_source', 'custom_text'], 'custom_text'],
])
  test(`OBS creates a compatible text source on ${name}`, async () => {
    const { service, calls } = fixture({ GetInputKindList: { inputKinds: kinds } });
    await service.configureSongRequestSource();
    const created = calls.find(c => c.type === 'CreateInput');
    assert.equal(created.data.inputKind, expected);
    assert.equal(created.data.inputName, '锤子播放状态');
    assert.equal(created.data.sceneName, 'Fixture scene');
  });
test('OBS refuses to create a source when no text input kind exists', async () => {
  const { service, calls } = fixture({ GetInputKindList: { inputKinds: ['image_source'] } });
  await assert.rejects(service.configureSongRequestSource(), /未找到可用的文字源/);
  assert.equal(
    calls.some(c => c.type === 'CreateInput'),
    false
  );
});
test('hiding a missing text source is harmless, while an existing source is disabled', async () => {
  const empty = fixture();
  await empty.service.hideSongRequestSource();
  assert.equal(
    empty.calls.some(c => c.type === 'SetSceneItemEnabled'),
    false
  );
  const existing = fixture({ GetSceneItemList: { sceneItems: [{ sourceName: '锤子播放状态', sceneItemId: 5 }] } });
  await existing.service.hideSongRequestSource();
  assert.equal(existing.calls.find(c => c.type === 'SetSceneItemEnabled').data.sceneItemEnabled, false);
});
test('OBS templates render all occurrences, artists, queue order and unknown fields', async () => {
  const { service, calls } = fixture();
  service.setConfig({
    textTemplate: '{歌曲名}|{歌曲名}|{歌手}|{点歌者}\n{点歌列表}\n{未知}|{constructor}|{toString}',
    playlistTemplate: '{序号}:{歌曲名}:{歌手}:{点歌者}',
  });
  await service.updateSongRequestText({ name: 'Current', artist: ['A', 'B'], requester: 'Alice' }, [
    { name: 'Next', artist: 'C', requester: 'Bob' },
    { name: '', artist: [] },
  ]);
  assert.equal(
    calls[0].data.inputSettings.text,
    'Current|Current|A / B|Alice\n1:Next:C:Bob\n2:[未知歌曲]:[未知歌手]:[系统]\n{未知}|{constructor}|{toString}'
  );
});
test('OBS can render an idle player with an empty queue', async () => {
  const { service, calls } = fixture();
  service.setConfig({ textTemplate: '{歌曲名}|{歌手}|{点歌者}|{点歌列表}' });
  await service.updateSongRequestText(null, []);
  assert.equal(calls[0].data.inputSettings.text, '[未知歌曲]|[未知歌手]|[系统]|暂无点歌');
});
test('OBS template values containing dollar signs or placeholder text remain literal', async () => {
  const { service, calls } = fixture();
  service.setConfig({ textTemplate: '{歌曲名}|{歌手}|{点歌者}|{点歌列表}', playlistTemplate: '{歌曲名}:{点歌者}' });
  await service.updateSongRequestText({ name: '$& {歌手}', artist: '$1', requester: '$$' }, [
    { name: '$&', artist: 'A', requester: '$$' },
  ]);
  assert.equal(calls[0].data.inputSettings.text, '$& {歌手}|$1|$$|$&:$$');
});
test('OBS text updates propagate request failure so the caller can report it', async () => {
  const { service } = fixture({
    SetInputSettings: () => {
      throw Error('missing source');
    },
  });
  await assert.rejects(service.updateSongRequestText({ name: 'Current', artist: 'A' }, []), /missing source/);
});
