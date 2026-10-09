const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { installBrowser, deferred } = require('./helpers/browser.cjs');
installBrowser();
const { BilibiliService } = require('../src/renderer/services/bilibiliApi.ts');
const { useUserStore } = require('../src/renderer/store/userStore.ts');
beforeEach(() => useUserStore.getState().clearLoginState());
function mockAPI(t, handler) {
  const original = axios.get;
  t.after(() => (axios.get = original));
  axios.get = handler;
}
test('QR generation and polling preserve expiry status and request cookies', async t => {
  mockAPI(t, async (url, options) => {
    if (url.includes('/generate'))
      return { data: { code: 0, data: { url: 'https://example.test/qr', qrcode_key: 'fixture-key' } } };
    assert.equal(options.withCredentials, true);
    assert.match(url, /qrcode_key=fixture-key/);
    return { data: { code: 0, data: { code: 86038, message: '二维码已失效' } } };
  });
  assert.equal((await BilibiliService.generateQRCode()).qrcode_key, 'fixture-key');
  assert.equal((await BilibiliService.pollQRCodeStatus('fixture-key')).code, 86038);
});
test('Bilibili API-level errors are rejected instead of becoming valid account data', async t => {
  mockAPI(t, async () => ({ data: { code: -101, message: '未登录' } }));
  await assert.rejects(BilibiliService.getUserInfo(), /未登录/);
  await assert.rejects(BilibiliService.getLiveRoomInfo(123), /未登录/);
});
test('account refresh stores user identity and room only after both requests succeed', async t => {
  mockAPI(t, async (url, options) => {
    assert.equal(options.withCredentials, true);
    return {
      data: {
        code: 0,
        data: url.includes('/nav') ? { isLogin: true, mid: 123, uname: 'Alice', face: 'fixture' } : { room_id: 456 },
      },
    };
  });
  assert.equal(await useUserStore.getState().refreshUserData(), true);
  assert.equal(useUserStore.getState().userId, 123);
  assert.equal(useUserStore.getState().roomId, 456);
});
test('accounts without a live room can remain logged in for official live settings', async t => {
  mockAPI(t, async url => ({
    data: {
      code: 0,
      data: url.includes('/nav') ? { isLogin: true, mid: 123, uname: 'Alice', face: '' } : { room_id: 0 },
    },
  }));
  assert.equal(await useUserStore.getState().refreshUserData(), true);
  assert.equal(useUserStore.getState().isLoggedIn, true);
  assert.equal(useUserStore.getState().roomId, null);
});
test('expired accounts clear identity without requesting room information', async t => {
  useUserStore.getState().setLoginState(true, 'Alice', 123, '', 456);
  let calls = 0;
  mockAPI(t, async () => {
    calls++;
    return { data: { code: 0, data: { isLogin: false } } };
  });
  assert.equal(await useUserStore.getState().refreshUserData(), false);
  assert.equal(calls, 1);
  assert.equal(useUserStore.getState().userId, null);
  assert.equal(useUserStore.getState().roomId, null);
});
test('a stale failed account request cannot log out a newer account', async t => {
  const old = deferred();
  mockAPI(t, () => old.promise);
  const pending = useUserStore.getState().refreshUserData();
  useUserStore.getState().setLoginState(true, 'New', 789, '', 987);
  old.reject(Error('old request offline'));
  assert.equal(await pending, false);
  assert.equal(useUserStore.getState().userId, 789);
});
test('logout failure is propagated and retains the current account for retry', async () => {
  useUserStore.getState().setLoginState(true, 'Alice', 123, '', 456);
  window.electron = { app: { logout: async () => ({ success: false, error: 'cookie removal failed' }) } };
  await assert.rejects(useUserStore.getState().logout(), /cookie removal failed/);
  assert.equal(useUserStore.getState().isLoggedIn, true);
  assert.equal(useUserStore.getState().userId, 123);
});
