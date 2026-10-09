const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { loadTypescript } = require('./helpers/load-typescript.cjs');
function fixture(platform = 'darwin') {
  const windows = [],
    external = [],
    calls = [];
  class Window extends EventEmitter {
    constructor(options = {}) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.send = (...args) => calls.push(['send', ...args]);
      this.bounds = { x: 20, y: 30, width: 400, height: 800 };
      this.visible = true;
      this.top = false;
      windows.push(this);
    }
    isDestroyed() {
      return !!this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
    getBounds() {
      return this.bounds;
    }
    setBounds(value) {
      this.bounds = value;
    }
    isAlwaysOnTop() {
      return this.top;
    }
    setAlwaysOnTop(value) {
      this.top = value;
    }
    setContentProtection(value) {
      this.protected = value;
    }
    setIgnoreMouseEvents(value) {
      this.ignored = value;
      calls.push(['ignore', value]);
    }
    setOpacity(value) {
      this.opacity = value;
    }
    isVisible() {
      return this.visible;
    }
    isMinimized() {
      return !!this.minimized;
    }
    hide() {
      this.visible = false;
    }
    showInactive() {
      this.visible = true;
    }
    moveTop() {}
  }
  const ipcMain = new EventEmitter(),
    handlers = new Map();
  ipcMain.handle = (name, fn) => handlers.set(name, fn);
  const { createChatOverlayController } = loadTypescript(
    path.resolve('src/main/chatOverlay.ts'),
    {
      electron: {
        BrowserWindow: Window,
        ipcMain,
        app: { getVersion: () => '0.1.2' },
        shell: { openExternal: async url => external.push(url) },
      },
    },
    { process: { platform } }
  );
  const loads = [];
  const controller = createChatOverlayController((window, sensor) => loads.push({ window, sensor }));
  const window = new Window();
  controller.attach(window);
  const send = (name, value, sender = window.webContents) => ipcMain.emit(name, { sender }, value);
  return { windows, window, controller, send, handlers, external, calls, loads };
}
test('click-through can be suspended for dialogs and is reset when disabled', () => {
  const f = fixture();
  f.send('set-ignore-mouse-events', true);
  assert.notEqual(f.window.ignored, true);
  f.send('set-click-through', true);
  f.send('set-ignore-mouse-events', true);
  assert.equal(f.window.ignored, true);
  f.send('set-click-through-suspended', true);
  assert.equal(f.window.ignored, false);
  f.send('set-ignore-mouse-events', true);
  assert.equal(f.window.ignored, false);
  f.send('set-click-through-suspended', false);
  f.send('set-ignore-mouse-events', true);
  assert.equal(f.window.ignored, true);
  f.send('set-click-through', false);
  assert.equal(f.window.ignored, false);
});
test('other renderer windows cannot mutate overlay or open external URLs', async () => {
  const f = fixture();
  for (const name of [
    'set-always-on-top',
    'set-click-through',
    'set-ignore-mouse-events',
    'set-window-opacity',
    'open-external',
  ]) {
    f.send(name, name === 'open-external' ? 'https://example.com' : true, {});
  }
  assert.equal(f.window.top, false);
  assert.notEqual(f.window.ignored, true);
  assert.equal(f.external.length, 0);
  assert.throws(() => f.handlers.get('get-app-version')({ sender: {} }), /Only the overlay/);
  assert.match(
    f.handlers.get('get-app-version')({ sender: f.window.webContents }),
    /chat-overlay 1\.1\.1.*Hammer 0\.1\.2/
  );
});
test('native opacity rejects invalid values and external links allow only HTTP(S)', () => {
  const f = fixture();
  f.send('set-window-opacity', 0.5);
  for (const value of [NaN, Infinity, -1, 2, '0.5']) f.send('set-window-opacity', value);
  assert.equal(f.window.opacity, 0.5);
  for (const url of ['file:///tmp/a', 'javascript:alert(1)', 'https://', 123]) f.send('open-external', url);
  assert.equal(f.external.length, 0);
  f.send('open-external', 'https://github.com/laplace-live/chat-overlay');
  assert.deepEqual(f.external, ['https://github.com/laplace-live/chat-overlay']);
});
test('Linux sensor follows bounds, pin and capture protection, and yields title-bar input', () => {
  const f = fixture('linux');
  f.controller.setContentProtection(true);
  f.send('set-title-bar-height', 44);
  f.send('set-click-through', true);
  const sensor = f.windows[1];
  assert.equal(f.loads[0].sensor, true);
  assert.equal(sensor.bounds.height, 44);
  assert.equal(sensor.protected, true);
  assert.equal(sensor.top, false);
  assert.equal(f.window.ignored, true);
  f.send('set-always-on-top', true);
  assert.equal(sensor.top, true);
  f.send('title-bar-hovered', undefined, sensor.webContents);
  assert.equal(f.window.ignored, false);
  f.window.bounds.x = 50;
  f.window.emit('move');
  assert.equal(sensor.bounds.x, 50);
  f.controller.setContentProtection(false);
  assert.equal(sensor.protected, false);
  f.send('set-click-through-suspended', true);
  assert.equal(sensor.visible, false);
  f.send('set-click-through-suspended', false);
  assert.equal(sensor.visible, true);
  f.window.minimized = true;
  f.window.emit('minimize');
  assert.equal(sensor.visible, false);
  assert.equal(f.window.ignored, false);
  f.window.minimized = false;
  f.window.emit('restore');
  assert.equal(sensor.visible, true);
  assert.equal(f.window.ignored, true);
});
test('Linux Escape and window closure destroy sensor; replacement starts interactive', () => {
  const f = fixture('linux');
  f.send('set-click-through', true);
  f.window.webContents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' });
  assert.equal(f.windows[1].destroyed, true);
  assert.equal(f.window.ignored, false);
  f.send('set-click-through', true);
  const sensor = f.windows[2];
  f.window.destroy();
  assert.equal(sensor.destroyed, true);
  const replacement = new f.window.constructor();
  f.controller.attach(replacement);
  f.send('set-ignore-mouse-events', true, replacement.webContents);
  assert.notEqual(replacement.ignored, true);
});
test('renderer reload resets ignored input and destroys its old sensor', () => {
  const f = fixture('linux');
  f.send('set-click-through', true);
  f.window.webContents.emit('did-start-loading');
  assert.equal(f.window.ignored, false);
  assert.equal(f.windows[1].destroyed, true);
});
