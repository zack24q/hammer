// Run after `npm run package`: real Hammer main/preloads/renderer and local bridge.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-overlay-smoke-'));
app.setPath('userData', profile);
app.setName('锤子');
const errors = [];
let main, overlay, producer;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await wait(40);
  }
  throw new Error(`Timed out: ${label}`);
}
const evaluate = script => overlay.webContents.executeJavaScript(script, true);
app.on('ready', () => {
  // No real account access or network pages in this smoke test.
  session.defaultSession.protocol.handle(
    'https',
    () =>
      new Response('<!doctype html><body>Fixture</body>', {
        headers: { 'Content-Type': 'text/html' },
      })
  );
});
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, level, message) => {
    if (level >= 3 && contents.getURL().includes('chat_overlay_window')) errors.push(message);
  });
});
require(path.join(root, '.vite/build/main.js'));
async function menu(item) {
  await evaluate(
    `document.querySelector('#settings-btn').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,button:0,pointerType:'mouse'}))`
  );
  await until(() => evaluate(`!!document.querySelector('[role=menu]')`), 'menu');
  await evaluate(
    `Array.from(document.querySelectorAll('[role=menuitem]')).find(e => e.textContent.includes(${JSON.stringify(item)})).click()`
  );
  await until(() => evaluate(`!!document.querySelector('[role=dialog]')`), item);
}
async function closeDialog() {
  await evaluate(
    `Array.from(document.querySelectorAll('[role=dialog] button')).find(b => b.textContent === 'Close').click()`
  );
  await until(() => evaluate(`!document.querySelector('[role=dialog]')`), 'dialog close');
}
app
  .whenReady()
  .then(async () => {
    await until(() => BrowserWindow.getAllWindows().length > 0, 'main window');
    main = BrowserWindow.getAllWindows()[0];
    await until(() => main.webContents.executeJavaScript('!!window.electron'), 'main preload');
    main.hide();
    const result = await main.webContents.executeJavaScript('window.electron.chatOverlay.open(true)');
    assert.equal(result.success, true);
    overlay = BrowserWindow.fromId(result.windowId);
    const ignores = [],
      protectedCalls = [];
    const ignoreMouse = overlay.setIgnoreMouseEvents.bind(overlay);
    overlay.setIgnoreMouseEvents = (...args) => {
      ignores.push(args[0]);
      return ignoreMouse(...args);
    };
    const protect = overlay.setContentProtection.bind(overlay);
    overlay.setContentProtection = value => {
      protectedCalls.push(value);
      return protect(value);
    };
    await until(() => evaluate(`!!document.querySelector('#title-bar')`), 'latest renderer');
    assert.equal(overlay.isAlwaysOnTop(), false);
    assert.equal(await evaluate(`document.querySelector('#title-bar').getBoundingClientRect().height`), 48);
    await evaluate(
      `localStorage.setItem('overlay-settings', JSON.stringify({state:{serverHost:'localhost', serverPort:'9696',showInteractionEvents:true,showGiftFree:true,showEntryEffect:true},version:0}))`
    );
    overlay.webContents.reload();
    await once(overlay.webContents, 'did-finish-load');
    await until(() => evaluate(`!!document.querySelector('#title-bar')`), 'reloaded settings');
    producer = new WebSocket('ws://localhost:9696', 'laplace-event-bridge-role-server');
    await once(producer, 'open');
    await wait(150);
    const image = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/%3E';
    const base = { username: '测试主播', guardType: 0, origin: 123 };
    const events = [
      { type: 'message', id: 'text', message: 'SMOKE_TEXT', bmotes: {} },
      { type: 'message', id: 'emote', message: '', emote: { url: image, emoticon_unique: 'smile', bulge_display: 0 } },
      { type: 'superchat', id: 'sc', message: 'SMOKE_SC', priceNormalized: 30 },
      { type: 'gift', id: 'paid', giftName: '测试礼物', giftAmount: 2, coinType: 'gold', priceNormalized: 10 },
      {
        type: 'toast',
        id: 'guard',
        message: '开通舰长',
        toastType: 3,
        toastName: '舰长',
        toastAmount: 1,
        toastAmountUnit: '月',
        priceNormalized: 138,
      },
      { type: 'interaction', id: 'interaction', action: 1 },
      { type: 'like-click', id: 'like', message: '点赞了直播间' },
      { type: 'gift', id: 'free', giftName: '免费礼物', giftAmount: 1, coinType: 'silver', priceNormalized: 0 },
      { type: 'entry-effect', id: 'entry', message: 'arrival' },
      { type: 'online-update', id: 'online', online: 42 },
      { type: 'watched-update', id: 'watched', watched: 10 },
    ];
    for (const event of events) producer.send(JSON.stringify({ ...base, ...event }));
    await until(() => evaluate(`document.querySelectorAll('[data-slot=event]').length >= 9`), 'display events');
    assert.equal(await evaluate(`!!document.querySelector('.emote')`), true);
    assert.equal(await evaluate(`document.body.textContent.includes('42')`), true);
    assert.equal(await evaluate(`document.body.textContent.includes('SMOKE_SC')`), true);
    await evaluate(`document.querySelector('#always-on-top-btn').click()`);
    await until(() => overlay.isAlwaysOnTop(), 'native always-on-top');
    await evaluate(`document.querySelector('#click-through-btn').click()`);
    await wait(50);
    await evaluate(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientY:100}))`);
    await until(() => ignores.at(-1) === true, 'native click-through');
    await menu('Settings');
    await until(() => ignores.at(-1) === false, 'dialog pauses click-through');
    await closeDialog();
    await evaluate(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientY:100}))`);
    await until(() => ignores.at(-1) === true, 'click-through resumes');
    await menu('About');
    assert.match(await evaluate(`document.querySelector('[role=dialog]').textContent`), /chat-overlay 1\.1\.1.*Hammer/);
    await closeDialog();
    await main.webContents.executeJavaScript('window.electron.chatOverlay.setContentProtection(false)');
    assert.equal(protectedCalls.at(-1), false);
    // Check cap and control messages on actual store/SDK path.
    for (let id = 0; id < 110; id++)
      producer.send(JSON.stringify({ ...base, type: 'message', id: `batch-${id}`, message: `BATCH_${id}` }));
    for (let id = 0; id < 120; id++)
      producer.send(JSON.stringify({ type: 'likes-update', id: `stats-${id}`, likes: id }));
    await until(
      () =>
        evaluate(
          `document.querySelectorAll('[data-slot=event]').length >= 90 && document.body.textContent.includes('BATCH_109')`
        ),
      '100-message history'
    );
    assert.equal(await evaluate(`document.querySelector('[data-slot=event]').textContent.includes('BATCH_10')`), true);
    assert.equal(await evaluate(`document.body.textContent.includes('BATCH_0')`), false);
    await evaluate(`document.querySelector('#close-btn').click()`);
    await until(() => overlay.isDestroyed(), 'overlay close button');
    const reopened = await main.webContents.executeJavaScript('window.electron.chatOverlay.open(false)');
    assert.equal(reopened.success, true);
    overlay = BrowserWindow.fromId(reopened.windowId);
    await until(() => evaluate(`!!document.querySelector('#title-bar')`), 'overlay reopen');
    await until(() => overlay.isAlwaysOnTop(), 'persisted pin restored');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'PASS latest overlay: actual Hammer bridge/preloads, text/emote/SC/gift/guard, 100-message cap, native pin/click-through/dialogs, attribution, capture toggle, close/reopen'
    );
    producer.terminate();
    app.quit();
  })
  .catch(async error => {
    console.error(error);
    console.error('Overlay errors:', errors);
    if (overlay && !overlay.isDestroyed())
      console.error(
        'Overlay rows:',
        await evaluate(
          `JSON.stringify(Array.from(document.querySelectorAll('[data-slot=event]')).map(e => e.dataset.eventType))`
        )
      );
    producer?.terminate();
    app.exit(1);
  });
setTimeout(() => {
  console.error('Overlay smoke timed out');
  app.exit(1);
}, 30000).unref();
