const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { clearBilibiliCookies } = require('../src/main/bilibiliSession.ts');
const { getWebUserAgent } = require('../src/main/userAgent.ts');
const { buildLaplaceSettingsScript } = require('../src/renderer/services/laplaceSettings.ts');
const { uploadCookies } = require('../src/renderer/services/cookies.ts');
const axios = require('axios');
const CryptoJS = require('crypto-js');
const { gunzipSync } = require('node:zlib');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

test('logout removes both domain and host cookies using valid URLs', async () => {
  const removals = [];
  await clearBilibiliCookies({
    async get(filter) {
      assert.deepEqual(filter, { domain: 'bilibili.com' });
      return [
        { domain: '.bilibili.com', path: '/', name: 'domain-cookie' },
        { domain: 'passport.bilibili.com', path: '/login', name: 'host-cookie' },
      ];
    },
    async remove(url, name) {
      assert.equal(new URL(url).hostname.startsWith('.'), false);
      removals.push([url, name]);
    },
  });
  assert.deepEqual(removals, [
    ['https://bilibili.com/', 'domain-cookie'],
    ['https://passport.bilibili.com/login', 'host-cookie'],
  ]);
});

test('logout propagates cookie-removal failure instead of reporting success', async () => {
  await assert.rejects(
    clearBilibiliCookies({
      async get() {
        return [{ domain: '.bilibili.com', path: '/', name: 'test' }];
      },
      async remove() {
        throw new Error('cookie removal failed');
      },
    }),
    /cookie removal failed/
  );
});

test('localized User-Agent can be used in Fetch request headers', () => {
  const input = 'Mozilla/5.0 锤子/0.1.2 Chrome/136.0 Electron/36.5.0';
  const value = getWebUserAgent(input, '锤子');
  assert.doesNotThrow(() => new Headers({ 'User-Agent': value }));
  assert.match(value, /Hammer\/0\.1\.2/);
  assert.equal(getWebUserAgent('Mozilla/5.0 Hammer/0.1.2', 'Hammer'), 'Mozilla/5.0 Hammer/0.1.2');
});

const settings = {
  roomId: '123',
  userId: '456',
  username: "测试'用户\\名字\n😀",
  colorScheme: 'dark',
  loginSyncToken: 'test@token',
};
function apply(config, overrides = {}) {
  const values = new Map(config === undefined ? [] : [['laplaceChatOptions_v4', config]]);
  const result = vm.runInNewContext(buildLaplaceSettingsScript({ ...settings, ...overrides }), {
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
  });
  return { result, values };
}

test('LAPLACE sync preserves existing flat settings and updates the existing room once', () => {
  const { result, values } = apply(
    JSON.stringify({
      customCss: '.test {color: red}',
      showGift: false,
      roomSearchHistory: [{ value: 123, username: 'old', extra: true }, { value: '999' }],
    })
  );
  assert.equal(result.success, true);
  const config = JSON.parse(values.get('laplaceChatOptions_v4'));
  assert.deepEqual(config.roomIds, ['123']);
  assert.equal(config.loginSyncToken, 'test@token');
  assert.equal(config.customCss, '.test {color: red}');
  assert.equal(config.showGift, false);
  assert.equal(config.roomSearchHistory.length, 2);
  assert.equal(config.roomSearchHistory[0].username, settings.username);
  assert.equal(config.roomSearchHistory[0].extra, true);
  assert.equal(values.get('laplaceChatActiveTab'), '"advanced"');
});

test('LAPLACE sync handles first use and rejects malformed storage without overwriting it', () => {
  assert.equal(apply().result.success, true);
  for (const raw of ['null', '[]', '"string"', '{bad json']) {
    const { result, values } = apply(raw);
    assert.equal(result.success, false);
    assert.equal(values.get('laplaceChatOptions_v4'), raw);
    assert.equal(values.has('laplaceChatActiveTab'), false);
  }
  const { result, values } = apply(undefined, { roomId: '0' });
  assert.equal(result.success, false);
  assert.equal(values.size, 0);
});

test('cookie upload stops on read failure or empty state without contacting the sync server', async t => {
  const previousWindow = global.window;
  const previousPost = axios.post;
  t.after(() => {
    global.window = previousWindow;
    axios.post = previousPost;
  });
  axios.post = async () => {
    assert.fail('must not upload invalid login state');
  };
  for (const result of [
    { success: false, error: 'read failed' },
    { success: true, data: { 'bilibili.com': [] } },
  ]) {
    global.window = { electron: { cookies: { getCookiesByDomains: async () => result } } };
    assert.equal((await uploadCookies({ uuid: 'test-uuid', password: 'test-password' })).success, false);
  }
});

test('cookie upload encrypts the payload, bounds network wait and never logs plaintext credentials', async t => {
  const previousWindow = global.window;
  const previousPost = axios.post;
  const previousLog = console.log;
  const logs = [];
  t.after(() => {
    global.window = previousWindow;
    axios.post = previousPost;
    console.log = previousLog;
  });
  console.log = (...args) => logs.push(args);
  const data = { 'bilibili.com': [{ name: 'SESSDATA', value: 'test-session-cookie' }] };
  global.window = { electron: { cookies: { getCookiesByDomains: async () => ({ success: true, data }) } } };
  axios.post = async (url, body, options) => {
    assert.equal(url, 'https://login-sync.laplace.cn/update');
    assert.equal(options.timeout, 15000);
    const payload = JSON.parse(gunzipSync(body).toString());
    const key = CryptoJS.MD5('test-uuid-test-password').toString().substring(0, 16);
    const plaintext = CryptoJS.AES.decrypt(payload.encrypted, key).toString(CryptoJS.enc.Utf8);
    assert.deepEqual(JSON.parse(plaintext), { cookie_data: data });
    return { data: { action: 'done' } };
  };
  assert.equal((await uploadCookies({ uuid: 'test-uuid', password: 'test-password' })).success, true);
  assert.doesNotMatch(JSON.stringify(logs), /test-session-cookie|test-password/);
});

function waitForOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('child output timeout'));
    }, 5000);
    const onData = chunk => {
      output += chunk;
      const match = output.match(pattern);
      if (match) {
        cleanup();
        resolve(match);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
    };
    child.stdout.on('data', onData);
  });
}

const lifecycle = path.join(__dirname, '../src/main/developmentLifecycle.ts');
const childCode = `
  const { installDevelopmentShutdown } = require(${JSON.stringify(lifecycle)});
  installDevelopmentShutdown(() => { console.log('QUIT'); process.exit(0); }, {pollInterval: 20});
  console.log('READY', process.pid);
  setInterval(() => {}, 1000);
`;

test('development process exits cleanly for both termination signals', { timeout: 10000 }, async t => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', childCode], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    await waitForOutput(child, /READY (\d+)/);
    const quit = waitForOutput(child, /QUIT/);
    const exited = once(child, 'exit');
    child.kill(signal);
    await quit;
    assert.deepEqual(await exited, [0, null]);
  }
});

test('development process exits when only its launcher is killed', { timeout: 10000 }, async t => {
  const launcherCode = `require('node:child_process').spawn(process.execPath,
    ['-r','ts-node/register/transpile-only','-e',${JSON.stringify(childCode)}],
    {stdio:['ignore','inherit','inherit']});`;
  const launcher = spawn(process.execPath, ['-e', launcherCode], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = await waitForOutput(launcher, /READY (\d+)/);
  const childPid = Number(ready[1]);
  t.after(() => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL');
    try {
      process.kill(childPid, 'SIGKILL');
    } catch {
      /* already exited */
    }
  });
  const quit = waitForOutput(launcher, /QUIT/);
  launcher.kill('SIGTERM');
  await quit;
});

test('a pending account refresh cannot restore an old account after logout', async t => {
  const oldWindow = global.window;
  const oldStorage = global.localStorage;
  const values = new Map();
  global.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  global.window = { localStorage: global.localStorage, electron: { app: { logout: async () => ({ success: true }) } } };
  const { useUserStore } = require('../src/renderer/store/userStore.ts');
  const { BilibiliService } = require('../src/renderer/services/bilibiliApi.ts');
  const oldUserInfo = BilibiliService.getUserInfo;
  const oldRoomInfo = BilibiliService.getLiveRoomInfo;
  t.after(() => {
    useUserStore.getState().clearLoginState();
    BilibiliService.getUserInfo = oldUserInfo;
    BilibiliService.getLiveRoomInfo = oldRoomInfo;
    global.window = oldWindow;
    global.localStorage = oldStorage;
  });
  let resolveRoom;
  BilibiliService.getUserInfo = async () => ({ isLogin: true, mid: 456, uname: 'old account', face: '' });
  BilibiliService.getLiveRoomInfo = () =>
    new Promise(resolve => {
      resolveRoom = resolve;
    });
  useUserStore.getState().setLoginState(true, 'old account', 456, '', 123);
  const refresh = useUserStore.getState().refreshUserData();
  await new Promise(resolve => setImmediate(resolve));
  await useUserStore.getState().logout();
  resolveRoom({ room_id: 123 });
  assert.equal(await refresh, false);
  assert.equal(useUserStore.getState().isLoggedIn, false);
  assert.equal(useUserStore.getState().userId, null);

  // Account association also invalidates responses for a previous account.
  let resolveUser;
  BilibiliService.getUserInfo = () =>
    new Promise(resolve => {
      resolveUser = resolve;
    });
  const oldRefresh = useUserStore.getState().refreshUserData();
  useUserStore.getState().setLoginState(true, 'new account', 789, '', 987);
  resolveUser({ isLogin: true, mid: 456, uname: 'old account', face: '' });
  assert.equal(await oldRefresh, false);
  assert.equal(useUserStore.getState().userId, 789);
  assert.equal(useUserStore.getState().roomId, 987);
});
