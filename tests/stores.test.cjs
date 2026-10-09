const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { installBrowser } = require('./helpers/browser.cjs');
const { storage, classes } = installBrowser();
const { useSongStore } = require('../src/renderer/store/songStore.ts');
const { useSettingStore, getInitialOBSConfig } = require('../src/renderer/store/settingStore.ts');
const song = id => ({ id, name: id, artist: 'A', album: '', source: 'netease' });
beforeEach(() => {
  useSongStore.getState().updateDefaultPlaylist([song('a'), song('b'), song('c')]);
  useSettingStore.setState({
    blacklist: [],
    consoleConnected: false,
    theme: 'light',
    obsConfig: getInitialOBSConfig(),
  });
});

test('fixed playlist deletion preserves the current song when earlier entries are removed', () => {
  useSongStore.getState().setDefaultPlaylistIndex(2);
  useSongStore.getState().removeFromDefaultPlaylist(0);
  const state = useSongStore.getState();
  assert.deepEqual(
    state.defaultPlaylist.map(s => s.id),
    ['b', 'c']
  );
  assert.equal(state.defaultPlaylistIndex, 1);
});
test('removing the final playlist entry leaves a valid empty playlist index', () => {
  useSongStore.getState().updateDefaultPlaylist([song('a')]);
  useSongStore.getState().removeFromDefaultPlaylist(0);
  assert.deepEqual(useSongStore.getState().defaultPlaylist, []);
  assert.equal(useSongStore.getState().defaultPlaylistIndex, 0);
});
test('invalid playlist removals cannot silently delete another song', () => {
  for (const index of [-1, 20, NaN, 0.5]) useSongStore.getState().removeFromDefaultPlaylist(index);
  assert.deepEqual(
    useSongStore.getState().defaultPlaylist.map(s => s.id),
    ['a', 'b', 'c']
  );
});
test('playlist index rejects invalid values and resets after replacing the list', () => {
  useSongStore.getState().setDefaultPlaylistIndex(1);
  for (const index of [-1, 20, NaN, 0.5]) useSongStore.getState().setDefaultPlaylistIndex(index);
  assert.equal(useSongStore.getState().defaultPlaylistIndex, 1);
  useSongStore.getState().updateDefaultPlaylist([song('new')]);
  assert.equal(useSongStore.getState().defaultPlaylistIndex, 0);
});
test('restoring a persisted invalid playlist index repairs it before initial playback', async () => {
  storage.setItem(
    'song-store',
    JSON.stringify({ state: { defaultPlaylist: [song('a')], defaultPlaylistIndex: 99 }, version: 0 })
  );
  await useSongStore.persist.rehydrate();
  assert.equal(useSongStore.getState().defaultPlaylistIndex, 0);
  assert.equal(JSON.parse(storage.getItem('song-store')).state.defaultPlaylistIndex, 0);
});
test('OBS connection and text-template resets preserve each other’s settings', () => {
  const state = useSettingStore.getState();
  state.updateOBSConfig({
    address: 'fixture',
    port: 1234,
    password: 'fixture-password',
    textTemplate: 'custom',
    playlistTemplate: 'queue',
  });
  state.resetOBSTextTemplate();
  assert.equal(useSettingStore.getState().obsConfig.address, 'fixture');
  assert.equal(useSettingStore.getState().obsConfig.password, 'fixture-password');
  state.updateOBSConfig({ textTemplate: 'kept', playlistTemplate: 'kept queue' });
  state.resetOBSConnection();
  assert.equal(useSettingStore.getState().obsConfig.port, 4455);
  assert.equal(useSettingStore.getState().obsConfig.textTemplate, 'kept');
  assert.equal(useSettingStore.getState().obsConfig.playlistTemplate, 'kept queue');
});
test('blacklist supports case-insensitive substring matching without duplicates or empty entries', () => {
  const state = useSettingStore.getState();
  state.addToBlacklist('BAD');
  state.addToBlacklist('BAD');
  state.addToBlacklist('');
  assert.deepEqual(useSettingStore.getState().blacklist, ['BAD']);
  assert.equal(state.hasBlacklistedKeyword('a bad singer'), true);
  assert.equal(state.hasBlacklistedKeyword('good'), false);
  assert.equal(state.hasBlacklistedKeyword(''), false);
  state.removeFromBlacklist('BAD');
  assert.equal(state.hasBlacklistedKeyword('bad'), false);
});
test('regenerating danmaku credentials changes both parts and retains the token format', () => {
  const state = useSettingStore.getState(),
    previous = state.getMergedToken();
  state.regenerateDanmakuIds();
  const current = state.getMergedToken();
  assert.notEqual(current, previous);
  assert.equal(current.split('@').length, 2);
  assert.ok(current.split('@').every(Boolean));
});
test('setting persistence excludes transient connection state and restores preferences', async () => {
  const state = useSettingStore.getState();
  state.setConsoleConnected(true);
  state.setTheme('dark');
  const persisted = JSON.parse(storage.getItem('setting-store'));
  assert.equal('consoleConnected' in persisted.state, false);
  assert.equal(persisted.state.theme, 'dark');
  assert.equal(classes.has('dark-theme'), true);
  useSettingStore.setState({ theme: 'light' });
  await useSettingStore.persist.rehydrate();
  assert.equal(useSettingStore.getState().theme, 'light');
  // setState persists too; write the saved snapshot back before a simulated restart.
  storage.setItem('setting-store', JSON.stringify(persisted));
  await useSettingStore.persist.rehydrate();
  assert.equal(useSettingStore.getState().theme, 'dark');
  assert.equal(classes.has('dark-theme'), true);
});
