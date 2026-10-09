// Native controls adapted from laplace-live/chat-overlay, AGPL-3.0.
// Modified for Hammer on 2026-10-09: isolated lifecycle, sender checks and capture protection.
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';

/** Owns only the overlay and its Linux title-bar sensor, not Hammer's main window. */
export function createChatOverlayController(loadWindow: (window: BrowserWindow, sensor: boolean) => void) {
  let mainWindow: BrowserWindow | null = null;
  let contentProtection = false;
  const isOverlaySender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;

  const usesTitleBarSensor = process.platform === 'linux';

  // Click pass-through state. `suspended` covers title-bar overlays (settings,
  // about, the menu) that have to keep capturing input while they are open.
  let clickThroughEnabled = false;
  let clickThroughSuspended = false;
  let ignoringMouseEvents = false;
  let titleBarSensor: BrowserWindow | null = null;
  let titleBarHeight = 48;

  const isPassThroughActive = () => clickThroughEnabled && !clickThroughSuspended;

  // Park the sensor exactly over the main window's title bar.
  const syncSensorBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed() || !titleBarSensor || titleBarSensor.isDestroyed()) return;

    const { x, y, width } = mainWindow.getBounds();
    titleBarSensor.setBounds({ x, y, width, height: Math.round(titleBarHeight) });
  };

  // Single choke point for the window's mouse handling, so the platform paths
  // can't disagree about the current state. Toggling is a round trip to the
  // window server, so skip no-op writes.
  const applyIgnoreMouseEvents = (ignore: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed() || ignore === ignoringMouseEvents) return;

    ignoringMouseEvents = ignore;
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });

    // The sensor is only useful while the main window cannot see the pointer
    // itself; once it can, the sensor has to get out of the way of real clicks.
    if (titleBarSensor && !titleBarSensor.isDestroyed()) {
      titleBarSensor.setIgnoreMouseEvents(!ignore);
      if (ignore) titleBarSensor.moveTop();
    }
  };

  const destroyTitleBarSensor = () => {
    if (!titleBarSensor) return;

    const sensor = titleBarSensor;
    titleBarSensor = null;
    if (!sensor.isDestroyed()) sensor.destroy();
  };

  const createTitleBarSensor = () => {
    if (!mainWindow || mainWindow.isDestroyed() || titleBarSensor) return;

    const { x, y, width } = mainWindow.getBounds();
    titleBarSensor = new BrowserWindow({
      x,
      y,
      width,
      height: Math.round(titleBarHeight),
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: mainWindow.isAlwaysOnTop(),
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      // Never take focus from the overlay it is standing in front of
      focusable: false,
      acceptFirstMouse: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload-chat-overlay.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    loadWindow(titleBarSensor, true);
    titleBarSensor.setContentProtection(contentProtection);

    titleBarSensor.on('closed', () => {
      titleBarSensor = null;
    });
  };

  // Bring the window in line with the current pass-through state.
  const syncClickThrough = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (!clickThroughEnabled) {
      applyIgnoreMouseEvents(false);
      destroyTitleBarSensor();
      return;
    }

    // Suspended is temporary — a dialog is open — so the sensor is only parked,
    // not torn down: rebuilding it would spin up a whole renderer process again.
    if (clickThroughSuspended) {
      applyIgnoreMouseEvents(false);
      titleBarSensor?.hide();
      return;
    }

    // macOS/Windows drive the whole thing from the renderer's mousemove handler,
    // which keeps seeing the cursor through `forward: true`. Everything below is
    // about the sensor window, so there is nothing to reconcile for them — and
    // disengaging here would strand them interactive until the next mousemove.
    if (!usesTitleBarSensor) return;

    // Being its own window, the sensor does not follow the overlay off-screen: left
    // alone it survives a minimize as an invisible strip that still swallows every
    // click in the title bar's old position. Park it like a dialog does.
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
      applyIgnoreMouseEvents(false);
      titleBarSensor?.hide();
      return;
    }

    createTitleBarSensor();
    syncSensorBounds();
    titleBarSensor?.showInactive();
    // Start out passing through; the sensor hands control back on hover. This is
    // also what gives a freshly created sensor its armed state, which is sound
    // because every path that clears the sensor leaves the window interactive.
    applyIgnoreMouseEvents(true);
  };

  // Turning pass-through off is normally a click on the title bar, which is not
  // available when it covers the whole window. Key events still reach a window
  // that ignores the pointer, so Escape on the focused overlay is the way back —
  // reachable with the window switcher even when every click falls through.
  const setClickThroughEnabled = (enabled: boolean) => {
    clickThroughEnabled = enabled;
    mainWindow?.webContents.send('click-through-enabled', enabled);
    syncClickThrough();
  };

  const disableClickThroughOnEscape = () => {
    if (!usesTitleBarSensor || !mainWindow) return;

    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape' || !clickThroughEnabled) return;

      setClickThroughEnabled(false);
    });
  };

  // Register all IPC handlers once at startup
  const registerIpcHandlers = () => {
    // Handle opacity changes
    ipcMain.on('set-window-opacity', (event, opacity) => {
      if (!isOverlaySender(event)) return;
      if (typeof opacity === 'number' && Number.isFinite(opacity) && opacity >= 0 && opacity <= 1)
        mainWindow?.setOpacity(opacity);
    });

    // Handle always on top toggle
    ipcMain.on('set-always-on-top', (event, enabled) => {
      if (!isOverlaySender(event)) return;
      if (typeof enabled !== 'boolean') return;
      mainWindow?.setAlwaysOnTop(enabled);
      titleBarSensor?.setAlwaysOnTop(enabled);
    });

    // Handle click pass-through toggle
    ipcMain.on('set-click-through', (event, enabled) => {
      if (!isOverlaySender(event)) return;
      setClickThroughEnabled(Boolean(enabled));
    });

    // A title-bar overlay opened or closed; pause pass-through while one is up.
    ipcMain.on('set-click-through-suspended', (event, suspended) => {
      if (!isOverlaySender(event)) return;
      clickThroughSuspended = Boolean(suspended);
      syncClickThrough();
    });

    // The renderer owns the title bar's layout, so it reports how tall the
    // interactive strip is; the sensor has to cover exactly that.
    ipcMain.on('set-title-bar-height', (event, height) => {
      if (!isOverlaySender(event)) return;
      if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return;

      titleBarHeight = Math.min(height, mainWindow?.getBounds().height ?? height);
      syncSensorBounds();
    });

    // The sensor saw the cursor reach the title bar: give the pointer back to the
    // real window so the title bar behaves like it does everywhere else.
    ipcMain.on('title-bar-hovered', event => {
      if (event.sender !== titleBarSensor?.webContents) return;
      if (!isPassThroughActive()) return;

      applyIgnoreMouseEvents(false);
    });

    // Handle mouse enter/leave events for click-through mode
    ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
      if (!isOverlaySender(event)) return;
      // Only meaningful while pass-through is engaged; otherwise the window stays
      // interactive and the renderer's reports are noise.
      if (!isPassThroughActive()) return;

      applyIgnoreMouseEvents(Boolean(ignore));
    });

    // Handle get app version request
    ipcMain.handle('get-app-version', event => {
      if (!isOverlaySender(event)) throw new Error('Only the overlay can request its version');
      return `chat-overlay 1.1.1 (f940914) · Hammer ${app.getVersion()}`;
    });

    // Open external links in the system's default browser
    ipcMain.on('open-external', (event, url) => {
      if (!isOverlaySender(event)) return;
      // Only allow well-formed http(s) URLs to avoid opening arbitrary protocols
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        try {
          const target = new URL(url);
          if (target.protocol === 'https:' || target.protocol === 'http:') {
            void shell.openExternal(target.href).catch(error => console.error('Failed to open overlay link:', error));
          }
        } catch {
          /* Ignore malformed links. */
        }
      }
    });
  };

  registerIpcHandlers();
  return {
    attach(window: BrowserWindow) {
      mainWindow = window;
      clickThroughEnabled = false;
      clickThroughSuspended = false;
      ignoringMouseEvents = false;
      titleBarHeight = 48;
      contentProtection = false;
      disableClickThroughOnEscape();
      window.on('move', syncSensorBounds);
      window.on('resize', syncSensorBounds);
      window.on('hide', syncClickThrough);
      window.on('show', syncClickThrough);
      window.on('minimize', syncClickThrough);
      window.on('restore', syncClickThrough);
      window.webContents.on('did-start-loading', () => {
        clickThroughEnabled = false;
        clickThroughSuspended = false;
        syncClickThrough();
      });
      window.on('closed', () => {
        destroyTitleBarSensor();
        mainWindow = null;
        clickThroughEnabled = false;
        clickThroughSuspended = false;
        ignoringMouseEvents = false;
      });
    },
    setContentProtection(enabled: boolean) {
      contentProtection = enabled;
      mainWindow?.setContentProtection(enabled);
      titleBarSensor?.setContentProtection(enabled);
    },
  };
}
