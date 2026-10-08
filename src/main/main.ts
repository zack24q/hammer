// @ts-expect-error electron-squirrel-startup is not a typescript module
import started from 'electron-squirrel-startup';
import { app, BrowserWindow, ipcMain, session, Menu, globalShortcut, Tray, nativeImage, autoUpdater } from 'electron';
import path from 'node:path';
import windowStateKeeper from 'electron-window-state';
import * as semver from 'semver';
import { wsServer } from './websocket';
import { WINDOW_CONFIG, GITHUB_CONFIG } from './config';
import { pathToFileURL } from 'node:url';
import { BILIBILI_LIVE_PAGE } from '../shared/streaming';
import { installDevelopmentShutdown } from './developmentLifecycle';
import { getWebUserAgent } from './userAgent';

const initApp = () => {
  // Handle creating/removing shortcuts on Windows when installing/uninstalling.
  if (started) {
    return;
  }

  // 存储当前主窗口引用
  let mainWindow: BrowserWindow | null = null;
  // 存储chatOverlay窗口引用
  let chatOverlayWindow: BrowserWindow | null = null;
  // 创建托盘变量
  let tray: Tray | null = null;
  let isQuitting = false;

  // MARK: 设置自动更新服务
  const setupAutoUpdater = () => {
    // 设置更新服务器地址 使用代理
    autoUpdater.setFeedURL({
      url: `${GITHUB_CONFIG.PROXY}/https://github.com/zack24q/hammer/releases/latest/download`,
    });

    // 监听更新错误事件
    autoUpdater.on('error', error => {
      mainWindow?.webContents.send('app:update-error', {
        message: error.message || '更新发生未知错误',
      });
    });

    // 监听发现更新事件
    autoUpdater.on('update-available', () => {
      mainWindow?.webContents.send('app:update-available');
    });

    // 监听更新下载完成事件
    autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName, releaseDate, updateURL) => {
      mainWindow?.webContents.send('app:update-downloaded', {
        releaseNotes,
        releaseName,
        releaseDate,
        updateURL,
      });
    });
  };

  // 获取资源路径的辅助函数
  function getAssetPath(...paths: string[]): string {
    if (app.isPackaged) {
      // 打包后的路径
      return path.join(process.resourcesPath, ...paths);
    } else {
      // 开发环境路径
      return 'src/assets/icon.ico';
    }
  }

  // 图标路径
  const iconPath = getAssetPath('icon.ico');
  // 加载图标
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    console.error('Failed to load tray icon from path:', iconPath);
  }

  // MARK: 创建托盘图标
  const createTray = () => {
    tray = new Tray(icon);
    tray.setToolTip('锤子');

    // 创建托盘菜单
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示窗口',
        click: showMainWindow,
      },
      {
        label: '退出程序',
        click: () => quitApp(),
      },
    ]);

    tray.setContextMenu(contextMenu);

    // 点击托盘图标显示窗口
    tray.on('click', showMainWindow);
  };

  // MARK: 创建右键菜单函数
  const createContextMenu = (webContents: Electron.WebContents) => {
    return Menu.buildFromTemplate([
      {
        label: '后退',
        accelerator: 'Alt+Left',
        click: () => {
          const navigationHistory = webContents.navigationHistory;
          if (navigationHistory.canGoBack()) {
            navigationHistory.goBack();
          }
        },
        enabled: webContents.navigationHistory.canGoBack(),
      },
      {
        label: '刷新',
        accelerator: 'F5',
        click: () => {
          webContents.reload();
        },
      },
      { type: 'separator' },
      {
        label: '切换开发工具',
        accelerator: 'F12',
        click: () => {
          webContents.toggleDevTools();
        },
      },
    ]);
  };

  // MARK: 创建主窗口
  const createWindow = () => {
    // 加载窗口状态管理器
    const windowState = windowStateKeeper({
      defaultWidth: WINDOW_CONFIG.MAIN_WINDOW.WIDTH,
      defaultHeight: WINDOW_CONFIG.MAIN_WINDOW.HEIGHT,
    });

    // Create the browser window.
    mainWindow = new BrowserWindow({
      x: windowState.x,
      y: windowState.y,
      width: windowState.width,
      height: windowState.height,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        // 启用webview的支持
        webviewTag: true,
        // 启用nodeIntegration，允许在渲染进程中使用Node.js API
        nodeIntegration: true,
        // 启用上下文隔离
        contextIsolation: true,
        // 禁用同源策略，允许跨域请求
        webSecurity: false,
      },
    });

    mainWindow.webContents.on('will-attach-webview', (event, preferences, params) => {
      if (params.src !== BILIBILI_LIVE_PAGE && preferences.preload !== livePagePreload) return;
      if (params.src !== BILIBILI_LIVE_PAGE) {
        event.preventDefault();
        return;
      }
      preferences.preload = livePagePreload;
      preferences.nodeIntegration = false;
      preferences.nodeIntegrationInSubFrames = false;
      preferences.contextIsolation = true;
      preferences.sandbox = true;
      preferences.webSecurity = true;
    });
    mainWindow.webContents.on('did-attach-webview', (_, guest) => {
      guest.once('did-start-navigation', (_event, initialURL) => {
        if (initialURL !== BILIBILI_LIVE_PAGE) return;
        const isBilibiliURL = (value: string) => {
          try {
            const url = new URL(value);
            return (
              url.protocol === 'https:' && (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com'))
            );
          } catch {
            return false;
          }
        };
        guest.on('will-navigate', (event, url) => {
          if (!isBilibiliURL(url)) event.preventDefault();
        });
        guest.setWindowOpenHandler(({ url }) =>
          isBilibiliURL(url)
            ? {
                action: 'allow',
                overrideBrowserWindowOptions: {
                  autoHideMenuBar: true,
                  webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: true,
                    webSecurity: true,
                    preload: undefined,
                  },
                },
              }
            : { action: 'deny' }
        );
      });
    });

    // 启用内容保护，不会被OBS捕获到
    // mainWindow.setContentProtection(true);

    // 让窗口状态管理器监视窗口（自动保存和恢复窗口位置和大小）
    windowState.manage(mainWindow);

    // and load the index.html of the app.
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
    }

    // 关闭窗口时隐藏到托盘，退出应用时允许窗口正常关闭。
    mainWindow.on('close', event => {
      if (!isQuitting && mainWindow) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  };

  const showMainWindow = () => {
    if (isQuitting || !app.isReady()) return;
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  };

  // MARK: 创建弹幕浮层窗口
  const createChatOverlayWindow = () => {
    const windowState = windowStateKeeper({
      defaultWidth: 400,
      defaultHeight: 800,
      file: 'chat-overlay-window-state.json',
    });

    chatOverlayWindow = new BrowserWindow({
      x: windowState.x,
      y: windowState.y,
      width: windowState.width,
      height: windowState.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      hasShadow: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload-chat-overlay.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // 启用内容保护，不会被OBS捕获到
    // chatOverlayWindow.setContentProtection(true);

    windowState.manage(chatOverlayWindow);

    // 监听窗口关闭事件，通知主窗口更新状态
    chatOverlayWindow.on('closed', () => {
      // 通知主窗口弹幕浮层已关闭
      mainWindow?.webContents.send('chat-overlay:closed');
      chatOverlayWindow = null;
    });

    // and load the index.html of the app.
    if (CHAT_OVERLAY_WINDOW_VITE_DEV_SERVER_URL) {
      chatOverlayWindow.loadURL(CHAT_OVERLAY_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      chatOverlayWindow.loadFile(path.join(__dirname, `../renderer/${CHAT_OVERLAY_WINDOW_VITE_NAME}/index.html`));
    }

    // Open the DevTools.
    // chatOverlayWindow.webContents.openDevTools();

    return chatOverlayWindow;
  };

  // MARK: 直接退出应用函数
  const quitApp = () => {
    app.quit();
  };

  // Covers tray/UI exits, Cmd+Q, updates and development shutdown alike.
  app.once('before-quit', () => {
    isQuitting = true;
    console.log('正在退出程序...');
    if (tray && !tray.isDestroyed()) {
      tray.destroy();
      tray = null;
    }

    if (app.isReady()) globalShortcut.unregisterAll();

    // 关闭 WebSocket 服务器
    void wsServer.stop().catch(error => console.error('关闭 WebSocket 服务器失败:', error));
  });

  if (!app.isPackaged && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const dispose = installDevelopmentShutdown(quitApp);
    app.once('before-quit', dispose);
  }

  // MARK: 主窗口IPC事件
  const livePagePreload = path.join(__dirname, 'preload-bilibili-live.js');
  ipcMain.handle('streaming:get-page-config', event => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      return { success: false, error: '推流功能只能在主窗口中使用' };
    }
    return { success: true, data: { preload: pathToFileURL(livePagePreload).href } };
  });

  // 处理登出请求，清除 bilibili 的 cookie
  ipcMain.on('app:logout', async () => {
    try {
      const cookies = await session.defaultSession.cookies.get({ domain: 'bilibili.com' });
      for (const cookie of cookies) {
        const url = `https://${cookie.domain}${cookie.path}`;
        await session.defaultSession.cookies.remove(url, cookie.name);
      }
      console.log('Bilibili cookies cleared successfully');
    } catch (error) {
      console.error('Error clearing cookies:', error);
    }
  });

  // 获取指定域名的cookies
  ipcMain.handle('get-cookies-by-domains', async (event, domains: string[]) => {
    try {
      const cookiesMap: Record<string, Electron.Cookie[]> = {};

      for (const domain of domains) {
        const cookies = await session.defaultSession.cookies.get({ domain });
        if (cookies && cookies.length > 0) {
          cookiesMap[domain] = cookies;
        } else {
          cookiesMap[domain] = [];
        }
      }

      return { success: true, data: cookiesMap };
    } catch (error) {
      console.error('获取cookies失败:', error);
      return { success: false, error: String(error) };
    }
  });

  // 重置窗口大小与位置
  ipcMain.handle('window:reset-size-and-position', () => {
    if (mainWindow) {
      // 重置窗口到默认大小和位置
      mainWindow.setBounds(
        {
          x: 0,
          y: 0,
          width: WINDOW_CONFIG.MAIN_WINDOW.WIDTH,
          height: WINDOW_CONFIG.MAIN_WINDOW.HEIGHT,
        },
        true
      );

      // 居中显示窗口
      mainWindow.center();

      return { success: true };
    }
    return { success: false, error: 'Main window not found' };
  });

  // 打开chatOverlay窗口
  ipcMain.handle('chat-overlay:open', async (event, contentProtectionEnabled = false) => {
    try {
      if (chatOverlayWindow) {
        chatOverlayWindow.destroy();
      }
      chatOverlayWindow = createChatOverlayWindow();

      // 应用内容保护设置
      if (contentProtectionEnabled) {
        chatOverlayWindow.setContentProtection(true);
        console.log('已应用弹幕浮层窗口内容保护设置');
      }

      return { success: true, windowId: chatOverlayWindow.id };
    } catch (error) {
      console.error('Error creating chat overlay window:', error);
      return { success: false, error: error.message };
    }
  });

  // 关闭chatOverlay窗口
  ipcMain.handle('chat-overlay:close', () => {
    try {
      if (chatOverlayWindow) {
        if (chatOverlayWindow.isDestroyed()) {
          chatOverlayWindow = null;
        } else {
          chatOverlayWindow.close();
          chatOverlayWindow = null;
        }
        return { success: true };
      }
      return { success: false, error: 'Chat overlay window not found' };
    } catch (error) {
      console.error('Error closing chat overlay window:', error);
      return { success: false, error: error.message };
    }
  });

  // 重置悬浮窗大小与位置
  ipcMain.handle('chat-overlay:reset-size-and-position', () => {
    try {
      if (chatOverlayWindow && !chatOverlayWindow.isDestroyed()) {
        // 重置悬浮窗到默认大小和位置
        chatOverlayWindow.setBounds(
          {
            x: 0,
            y: 0,
            width: 400,
            height: 800,
          },
          true
        );

        // 居中显示悬浮窗
        chatOverlayWindow.center();

        return { success: true };
      }
      return { success: false, error: 'Chat overlay window not found or destroyed' };
    } catch (error) {
      console.error('Error resetting chat overlay window size and position:', error);
      return { success: false, error: error.message };
    }
  });

  // 退出程序
  ipcMain.handle('app:quit', () => {
    quitApp();
    return { success: true };
  });

  // 设置主窗口内容保护
  ipcMain.handle('window:set-content-protection', (event, enabled: boolean) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setContentProtection(enabled);
        return { success: true };
      }
      return { success: false, error: 'Main window not found or destroyed' };
    } catch (error) {
      console.error('Error setting main window content protection:', error);
      return { success: false, error: error.message };
    }
  });

  // 设置弹幕浮层窗口内容保护
  ipcMain.handle('chat-overlay:set-content-protection', (event, enabled: boolean) => {
    try {
      if (chatOverlayWindow && !chatOverlayWindow.isDestroyed()) {
        chatOverlayWindow.setContentProtection(enabled);
        return { success: true };
      }
      return { success: false, error: 'Chat overlay window not found or destroyed' };
    } catch (error) {
      console.error('Error setting chat overlay window content protection:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取内容保护设置
  ipcMain.handle('window:get-content-protection-settings', () => {
    try {
      // 这里需要从渲染进程获取设置，暂时返回默认值
      // 实际实现中，渲染进程会在应用启动时主动设置内容保护
      return { success: true, data: { mainWindow: false, chatOverlayWindow: false } };
    } catch (error) {
      console.error('Error getting content protection settings:', error);
      return { success: false, error: error.message };
    }
  });

  // 检查更新
  ipcMain.handle('app:check-for-updates', async () => {
    try {
      // 获取GitHub仓库信息
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const packageJson = require('../../package.json');
      const repo = packageJson.repository?.url?.match(/github\.com[:/]([^/]+\/[^/.]+)/)?.[1];

      if (!repo) {
        throw new Error('无法从 package.json 中获取仓库信息');
      }

      // 调用GitHub API获取最新版本(使用代理)
      const response = await fetch(`${GITHUB_CONFIG.PROXY}/https://api.github.com/repos/${repo}/releases/latest`);
      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const latestRelease = await response.json();
      const latestVersion = latestRelease.tag_name.replace(/^v/, ''); // 移除v前缀
      const currentVersion = app.getVersion();

      // 使用semver进行精确的版本比较
      const hasUpdate = semver.gt(latestVersion, currentVersion);

      return {
        success: true,
        currentVersion,
        latestVersion,
        hasUpdate,
        releaseUrl: latestRelease.html_url,
        releaseNotes: latestRelease.body || '',
        publishedAt: latestRelease.published_at,
      };
    } catch (error) {
      console.error('Error checking for updates:', error);
      return { success: false, error: error.message };
    }
  });

  // 执行更新检查
  ipcMain.handle('app:download-update', async () => {
    try {
      // 使用 autoUpdater 检查更新
      autoUpdater.checkForUpdates();
      return { success: true };
    } catch (error) {
      console.error('Error checking for updates:', error);
      return { success: false, error: error.message };
    }
  });

  // 执行更新安装（重启应用）
  ipcMain.handle('app:install-update', () => {
    try {
      // quitAndInstall closes windows before emitting before-quit.
      isQuitting = true;
      autoUpdater.quitAndInstall();
      quitApp();
      return { success: true };
    } catch (error) {
      isQuitting = false;
      console.error('Error installing update:', error);
      return { success: false, error: error.message };
    }
  });

  // MARK: 弹幕浮层窗口IPC事件
  // Handle opacity changes
  ipcMain.on('set-window-opacity', (event, opacity) => {
    chatOverlayWindow?.setOpacity(opacity);
  });

  // Handle always on top toggle
  ipcMain.on('set-always-on-top', (event, enabled) => {
    chatOverlayWindow?.setAlwaysOnTop(enabled);
  });

  // Handle click pass-through toggle
  ipcMain.on('set-click-through', (event, enabled) => {
    if (enabled) {
      // Don't make the entire window click-through immediately
      // Instead, let the renderer handle mouse tracking
      chatOverlayWindow?.webContents.send('click-through-enabled', true);
    } else {
      // Disable click pass-through
      chatOverlayWindow?.setIgnoreMouseEvents(false);
      chatOverlayWindow?.webContents.send('click-through-enabled', false);
    }
  });

  // Handle mouse enter/leave events for click-through mode
  ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
    chatOverlayWindow?.setIgnoreMouseEvents(ignore, { forward: true });
  });

  // MARK: 应用事件
  app.on('ready', () => {
    if (isQuitting) return;
    // Apply before creating any windows: page scripts may build Request headers
    // during initialization, before a did-finish-load injection can run.
    app.userAgentFallback = getWebUserAgent(app.userAgentFallback, app.getName());
    session.defaultSession.setUserAgent(app.userAgentFallback);

    // 全局移除菜单栏
    Menu.setApplicationMenu(null);

    // 允许跨域访问
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      // 如果是localhost或127.0.0.1的请求，根据目标域名设置请求头
      if (details.referrer.includes('http://localhost') || details.referrer.includes('http://127.0.0.1')) {
        const url = new URL(details.url);
        details.requestHeaders['Origin'] = `${url.protocol}//${url.hostname}`;
        details.requestHeaders['Referer'] = `${url.protocol}//${url.hostname}`;
      }

      callback({ requestHeaders: details.requestHeaders });
    });

    // 设置CSP头和允许跨域访问
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders };

      // 处理Set-Cookie头，将SameSite设为None并添加Secure标志
      if (responseHeaders['set-cookie']) {
        responseHeaders['set-cookie'] = responseHeaders['set-cookie'].map((cookie: string) => {
          // 如果cookie中没有SameSite，添加SameSite=None
          if (!cookie.includes('SameSite=')) {
            cookie += '; SameSite=None';
          } else {
            // 替换已有的SameSite值
            cookie = cookie.replace(/SameSite=(Lax|Strict|None)/i, 'SameSite=None');
          }

          // 确保有Secure标志(SameSite=None需要Secure标志)
          if (!cookie.includes('Secure')) {
            cookie += '; Secure';
          }

          return cookie;
        });
      }

      callback({
        responseHeaders,
      });
    });

    // 注册全局快捷键
    // 后退
    globalShortcut.register('Alt+Left', () => {
      const win = BrowserWindow.getFocusedWindow();
      if (win) {
        const history = win.webContents.navigationHistory;
        if (history.canGoBack()) {
          history.goBack();
        }
      }
    });

    // 刷新
    globalShortcut.register('F5', () => {
      const win = BrowserWindow.getFocusedWindow();
      if (win) {
        win.webContents.reload();
      }
    });

    // 开发者工具
    globalShortcut.register('F12', () => {
      const win = BrowserWindow.getFocusedWindow();
      if (win) {
        win.webContents.toggleDevTools();
      }
    });

    // 启动 WebSocket 服务器
    wsServer.start();

    createTray();
    createWindow();

    // 设置自动更新
    setupAutoUpdater();
  });

  // 为所有新建的webContents添加右键菜单
  app.on('web-contents-created', (_, webContents) => {
    webContents.on('context-menu', () => {
      createContextMenu(webContents).popup();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      // 不直接退出应用，保持托盘运行
      // app.quit(); - 注释掉这行
    }
  });

  app.on('activate', showMainWindow);
};

initApp();
