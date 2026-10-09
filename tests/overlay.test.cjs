const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { installBrowser } = require('./helpers/browser.cjs');
const { loadTypescript } = require('./helpers/load-typescript.cjs');
const { storage } = installBrowser();
const { useRuntimeStore } = loadTypescript(path.resolve('chat-overlay/src/store/useRuntimeStore.ts'), {
  '@laplace.live/event-bridge-sdk': { ConnectionState: { DISCONNECTED: 'disconnected' } },
});
const { useSettingsStore } = require('../chat-overlay/src/store/useSettingsStore.ts');

test('latest overlay retains the newest 100 events without mutating prior state', () => {
  useRuntimeStore.getState().clearMessages();
  const previous = useRuntimeStore.getState().messages;
  for (let id = 0; id < 110; id++) useRuntimeStore.getState().addMessage({ type: 'message', id });
  const messages = useRuntimeStore.getState().messages;
  assert.equal(messages.length, 100);
  assert.equal(messages[0].id, 10);
  assert.equal(messages[99].id, 109);
  assert.equal(previous.length, 0);
});

test('latest runtime store keeps event order and clears all events', () => {
  useRuntimeStore.getState().clearMessages();
  const established = { type: 'established', id: 'welcome' };
  const message = { type: 'message', id: 'message', message: 'hello' };
  useRuntimeStore.getState().addMessage(established);
  useRuntimeStore.getState().addMessage(message);
  assert.equal(useRuntimeStore.getState().messages.length, 2);
  assert.equal(useRuntimeStore.getState().messages[0].id, 'welcome');
  assert.equal(useRuntimeStore.getState().messages[1].message, 'hello');
  useRuntimeStore.getState().clearMessages();
  assert.equal(useRuntimeStore.getState().messages.length, 0);
});

test('new settings use latest key, authentication field and upstream defaults', () => {
  const state = useSettingsStore.getState();
  assert.equal(useSettingsStore.persist.getOptions().name, 'overlay-settings');
  assert.equal(state.alwaysOnTop, false);
  assert.equal(state.clickThrough, false);
  assert.equal(state.opacity, 80);
  assert.equal(state.baseFontSize, 20);
  assert.equal(state.serverPort, '9696');
  assert.equal(state.serverBridgeAuthToken, '');
  assert.equal('serverPassword' in state, false);
  state.setServerBridgeAuthToken('fixture');
  state.setCustomCSS('.event {color:red}');
  const persisted = JSON.parse(storage.getItem('overlay-settings')).state;
  assert.equal(persisted.serverBridgeAuthToken, 'fixture');
  assert.equal(persisted.customCSS, '.event {color:red}');
});

beforeEach(() => {
  useRuntimeStore.getState().clearMessages();
  useSettingsStore.setState({
    opacity: 80,
    baseFontSize: 20,
    alwaysOnTop: false,
    clickThrough: false,
    showInteractionEvents: true,
    showGiftFree: false,
    showEntryEffect: false,
    customCSS: '',
    serverHost: 'localhost',
    serverPort: '9696',
    serverBridgeAuthToken: '',
    allowedOrigins: '',
  });
});
