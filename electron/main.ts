import { app, BrowserWindow, ipcMain, dialog, powerSaveBlocker, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import { registerFalconWiFiIpc, shutdownFalconWiFi } from './falcon-wifi';
import {
  namespacedStorageGet,
  namespacedStorageSet,
  namespacedStorageRemove,
  namespacedStorageList,
} from './storage';
import { STORAGE_NAMESPACES, isStorageKeyAllowed, type StorageNamespace } from './storageNamespaces';
import {
  beginStartupCrashLoopTracking,
  markStartupSuccessful,
  recordStartupCrash,
} from './startupCrashLoop';
import { buildCspPolicy, pickCspMode, serializeCsp } from './cspPolicy';
import { assertTrustedSender } from './security';

let mainWindow: BrowserWindow | null = null;

/**
 * Renderer source: Vite dev server (unpackaged) vs bundled dist/ (packaged).
 * T1-85: the previous --dev arg escape hatch was removed. A packaged build
 * always loads the bundled renderer from dist/. There is no command-line
 * flag that flips a packaged build into dev mode — that was an attack
 * surface (any user could run `LaserForge.exe --dev`) for no legitimate
 * end-user benefit.
 */
const isDev = !app.isPackaged;
const DEV_SERVER_ORIGIN = 'http://localhost:3000';

function isExpectedDevServerUrl(url: string): boolean {
  try {
    return new URL(url).origin === DEV_SERVER_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * DevTools control: open automatically for unpackaged dev runs, or when a
 * support engineer explicitly sets ELECTRON_ENABLE_DEVTOOLS=1 to diagnose a
 * customer's installed copy. The env var path is intentionally less
 * discoverable than a command-line flag — it requires deliberate setup,
 * unlike `LaserForge.exe --dev` which any user could try casually.
 * Strict equality with '1' only (not any truthy string) so the variable
 * has to be set deliberately.
 */
const shouldOpenDevTools = isDev || process.env.ELECTRON_ENABLE_DEVTOOLS === '1';
const UPDATE_CHECK_DELAY_MS = 30_000;

type UpdateInstallResult =
  | { ok: true }
  | { ok: false; reason: 'not-packaged' | 'job-running' | 'install-failed'; message?: string };

type UpdateCheckResult =
  | { ok: true }
  | { ok: false; reason: 'not-packaged' | 'check-failed'; message?: string };

// T1-92: per-extension size caps applied before fs.readFileSync. Without
// this, a 5 GB SVG selected from the dialog blocks the main process for
// many seconds, allocates a 5 GB string, and ships it over IPC. Even a
// well-meaning user with a misconfigured CAD exporter could freeze or
// crash the app. Each cap is sized for legitimate content of that type:
// SVG rarely exceeds a few MB; DXF is allowed a larger import-boundary
// cap because some CAD exports are verbose. G-code can be tens of MB for fine work
// on a big bed; project JSON tracks scene + history at modest size.
//
// Note on .laserforge.json: path.extname("project.laserforge.json")
// returns ".json", so a separate ".laserforge.json" entry would never
// match. The ".json" cap covers project files identically.
const MAX_FILE_BYTES_BY_EXTENSION: Record<string, number> = {
  '.json':  50 * 1024 * 1024,
  '.svg':   25 * 1024 * 1024,
  '.dxf':   50 * 1024 * 1024,
  '.gcode': 100 * 1024 * 1024,
  '.nc':    100 * 1024 * 1024,
  '.png':   100 * 1024 * 1024,
  '.jpg':   100 * 1024 * 1024,
  '.jpeg':  100 * 1024 * 1024,
};
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;

// Enable Web Serial API in Electron
app.commandLine.appendSwitch('enable-features', 'ElectronSerialChooser,WebSerial');

app.on('web-contents-created', (_, contents) => {
  contents.session.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();
    // Never auto-select the first port. Let the user choose explicitly.
    if (!portList || portList.length === 0) {
      callback('');
      return;
    }
    void (async () => {
      const buttons = portList.map(p => p.displayName || p.portName);
      buttons.push('Cancel');
      const chosen = await dialog.showMessageBox({
        type: 'question',
        buttons,
        cancelId: buttons.length - 1,
        defaultId: 0,
        title: 'Select Serial Port',
        message: 'Choose the laser controller serial port to connect.',
        noLink: true,
      });
      if (chosen.response >= 0 && chosen.response < portList.length) {
        callback(portList[chosen.response].portId);
      } else {
        callback('');
      }
    })();
  });

  contents.session.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'serial';
  });

  contents.session.setDevicePermissionHandler((details) => {
    return details.deviceType === 'serial';
  });

  // T1-90: belt-and-suspenders navigation hardening for ANY WebContents
  // (main window, future child windows, future webview tags should we
  // ever enable them). The main window also has these handlers
  // installed in createWindow() — registering twice is idempotent for
  // setWindowOpenHandler (last call wins) and additive but harmless for
  // will-navigate (both fire; both event.preventDefault calls are no-
  // ops if any earlier handler already prevented). The duplication is
  // intentional: if a future code path creates a WebContents WITHOUT
  // going through createWindow(), this catches it.
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    const isDevServer = isDev && isExpectedDevServerUrl(url);
    const isAppFile = !isDev && url.startsWith('file://');
    if (!isDevServer && !isAppFile) {
      event.preventDefault();
    }
  });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    title: 'LaserForge',
    backgroundColor: '#0a0a12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // T1-89: enable Chromium's OS-level renderer sandbox. Without this,
      // a renderer compromised by XSS or by malicious imported content
      // (a doctored SVG, project file, or DXF) has access to the full
      // preload bridge AND to non-sandboxed Chromium APIs that exist
      // outside contextIsolation's strict contextBridge boundary.
      // The preload (electron/preload.ts) is already sandbox-compatible:
      // it only imports from 'electron' (contextBridge, ipcRenderer,
      // IpcRendererEvent — all whitelisted under sandbox) and exposes
      // the bridge purely via ipcRenderer.invoke / on, no fs/path/etc.
      // The renderer (src/) uses typeof-process guards on the few Node
      // touchpoints (loadFont's bundled-font fallback, ticket hashing's
      // deterministic-IDs env check), so Node globals being unavailable
      // under sandbox is not a regression — those guards already short-
      // circuit when process is undefined or stubbed.
      sandbox: true,
      webviewTag: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  // T1-90: navigation hardening on the main window. Without these, the
  // renderer can: window.open('https://attacker.com') opens a new window
  // with full Chromium chrome and no preload bridge restrictions; a
  // target=_blank link opens externally with no guard; location.href =
  // 'javascript:...' or other navigation escape may load attacker
  // content into our trusted origin. For a packaged Electron app, every
  // navigation attempt should be blocked or routed through the OS
  // browser explicitly.
  //
  // Belt-and-suspenders for any child WebContents (printers, future
  // dialogs, etc.) lives in the existing app.on('web-contents-created')
  // handler above.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // http(s) URLs open in the user's OS browser; everything else
    // (file://, javascript:, chrome:, mailto:, custom schemes) denied.
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevServer = isDev && isExpectedDevServerUrl(url);
    const isAppFile = !isDev && url.startsWith('file://');
    if (!isDevServer && !isAppFile) {
      event.preventDefault();
    }
  });

  // Content Security Policy — reduces XSS impact in the renderer
  // T3-8: dev stays relaxed for Vite; packaged production removes unsafe
  // script execution while preserving inline styles until the UI migration.
  const cspHeader = serializeCsp(buildCspPolicy(pickCspMode({ isDev })));
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspHeader],
      },
    });
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // T1-85: DevTools is now its own gate — for a packaged build, only opens
  // when ELECTRON_ENABLE_DEVTOOLS=1 is explicitly set in the environment.
  // No more `--dev` arg path.
  if (shouldOpenDevTools) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // T2-102 Layer 1: after the renderer has loaded and stayed alive for a
  // short stable window, clear the failed-launch marker. Until this fires,
  // the next boot treats this launch as failed and can enter safe mode.
  const startupWindow = mainWindow;
  startupWindow.webContents.once('did-finish-load', () => {
    const timer = setTimeout(() => {
      if (mainWindow === startupWindow) {
        markStartupSuccessful(app.getPath('userData'));
      }
    }, 10_000);
    if (typeof timer.unref === 'function') timer.unref();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

registerFalconWiFiIpc(() => mainWindow);

function recordMainProcessCrash(reason: string): void {
  try {
    recordStartupCrash(app.getPath('userData'), reason);
  } catch (err) {
    console.warn('[startup] failed to record startup crash', err);
  }
}

process.on('uncaughtExceptionMonitor', (err) => {
  recordMainProcessCrash(err.stack || err.message);
});

process.on('unhandledRejection', (reason) => {
  recordMainProcessCrash(String(reason));
});

app.on('render-process-gone', (_event, _webContents, details) => {
  recordMainProcessCrash(`renderer gone: ${details.reason} (${details.exitCode})`);
});

function sendUpdateEvent(kind: string, payload?: unknown): void {
  mainWindow?.webContents.send('update:event', { kind, payload });
}

autoUpdater.on('checking-for-update', () => {
  sendUpdateEvent('checking');
});

autoUpdater.on('update-available', (info) => {
  sendUpdateEvent('available', info);
});

autoUpdater.on('update-not-available', (info) => {
  sendUpdateEvent('not-available', info);
});

autoUpdater.on('download-progress', (progress) => {
  sendUpdateEvent('download-progress', progress);
});

autoUpdater.on('update-downloaded', (info) => {
  sendUpdateEvent('downloaded', info);
});

autoUpdater.on('error', (err) => {
  console.warn('[update] updater error', err);
  sendUpdateEvent('error', err instanceof Error ? err.message : String(err));
});

function scheduleAutoUpdateCheck(): void {
  if (isDev) return;
  autoUpdater.autoDownload = true;
  const timer = setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.warn('[update] check failed', err);
      sendUpdateEvent('error', err instanceof Error ? err.message : String(err));
    });
  }, UPDATE_CHECK_DELAY_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

app.whenReady().then(() => {
  const startupStatus = beginStartupCrashLoopTracking(app.getPath('userData'));
  if (startupStatus.shouldEnterSafeMode) {
    console.warn(
      `[startup] T2-102: ${startupStatus.consecutiveFailures} failed launches; `
      + 'safe-mode / rollback UI should be offered.',
    );
  }
  createWindow();
  scheduleAutoUpdateCheck();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

let safeShutdownDone = false;

/** OS wake lock id while a job is active (see power:acquireJobWakeLock). */
let jobWakeLockId: number | null = null;

function isJobWakeLockActive(): boolean {
  return jobWakeLockId !== null && powerSaveBlocker.isStarted(jobWakeLockId);
}

app.on('before-quit', (e) => {
  if (safeShutdownDone) return;
  e.preventDefault();
  safeShutdownDone = true;
  if (jobWakeLockId !== null && powerSaveBlocker.isStarted(jobWakeLockId)) {
    powerSaveBlocker.stop(jobWakeLockId);
    jobWakeLockId = null;
  }
  shutdownFalconWiFi();
  app.quit();
});

// ─── NATIVE FILE DIALOGS ─────────────────────────────────────────

ipcMain.handle('dialog:save', async (event, defaultName: string, content: string) => {
  assertTrustedSender(event);
  if (!mainWindow) return false;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [
      { name: 'LaserForge Project', extensions: ['laserforge.json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return false;
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return true;
});

ipcMain.handle('dialog:saveGcode', async (event, defaultName: string, content: string) => {
  assertTrustedSender(event);
  if (!mainWindow) return false;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [
      { name: 'G-code', extensions: ['gcode', 'nc', 'gc'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return false;
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return true;
});

ipcMain.handle('dialog:open', async (event) => {
  assertTrustedSender(event);
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [
      { name: 'LaserForge Project', extensions: ['json', 'laserforge.json'] },
      { name: 'SVG', extensions: ['svg'] },
      { name: 'DXF', extensions: ['dxf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();

  // T1-92: cap file size before reading. The check fires after the dialog
  // resolves so the user has already deliberately selected the file —
  // they get a useful error message naming the size, limit, and ext.
  const stat = fs.statSync(filePath);
  const limit = MAX_FILE_BYTES_BY_EXTENSION[ext] ?? DEFAULT_MAX_FILE_BYTES;
  if (stat.size > limit) {
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    const limitMB = (limit / (1024 * 1024)).toFixed(0);
    throw new Error(
      `File too large: ${sizeMB} MB. Maximum for ${ext || 'this file type'} is ${limitMB} MB.`,
    );
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  // T1-93: return basename only, not the absolute filePath. The full path
  // leaks the username and folder structure across the IPC boundary —
  // every renderer caller, every future log line, every future support
  // bundle (T2-108) would carry "C:\\Users\\johanns\\..." or
  // "/Users/jane/Desktop/secret_design.svg". The renderer doesn't need
  // the full path for any current feature; if a future feature truly
  // needs it (recent-files with "open from same folder"), expose it via
  // a separate explicit IPC with user opt-in.
  return { fileName: path.basename(filePath), content, ext };
});

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertStorageNamespaceKey(namespace: StorageNamespace, key: string): void {
  if (!isStorageKeyAllowed(namespace, key)) {
    throw new Error(`Invalid storage key for ${namespace} namespace`);
  }
}

function registerStorageNamespace(namespace: StorageNamespace): void {
  const channelPrefix = `storage:${namespace}`;
  ipcMain.handle(`${channelPrefix}:get`, (event, key: unknown) => {
    assertTrustedSender(event);
    assertNonEmptyString(key, 'storage key');
    assertStorageNamespaceKey(namespace, key);
    return namespacedStorageGet(namespace, key);
  });

  ipcMain.handle(`${channelPrefix}:set`, (event, key: unknown, value: unknown) => {
    assertTrustedSender(event);
    assertNonEmptyString(key, 'storage key');
    assertStorageNamespaceKey(namespace, key);
    if (typeof value !== 'string') throw new Error('Invalid storage value');
    namespacedStorageSet(namespace, key, value);
  });

  ipcMain.handle(`${channelPrefix}:remove`, (event, key: unknown) => {
    assertTrustedSender(event);
    assertNonEmptyString(key, 'storage key');
    assertStorageNamespaceKey(namespace, key);
    namespacedStorageRemove(namespace, key);
  });

  ipcMain.handle(`${channelPrefix}:list`, (event) => {
    assertTrustedSender(event);
    return namespacedStorageList(namespace);
  });
}

for (const namespace of STORAGE_NAMESPACES) {
  registerStorageNamespace(namespace);
}

// T1-84: storage:clear IPC was removed. The previous handler wiped every
// .json file in the storage directory in one call — license, profiles,
// presets, autosave, all jobs — exposing a single point of catastrophic
// data loss to any renderer code path. Audit confirmed no renderer code
// uses bulk clear, so the IPC was dead capability. If a future feature
// needs targeted clearing (e.g. "clear job log history"), add a scoped
// IPC handler per the T1-84 roadmap (storage:clearScope with explicit
// allow-list of key prefixes per scope).

// ─── WAKE LOCK ───────────────────────────────────────────────────
// Held during active jobs so Windows doesn't suspend USB,
// Chromium doesn't throttle our renderer, and the OS doesn't
// sleep. Released on all job-end paths.

ipcMain.handle('power:acquireJobWakeLock', (event) => {
  assertTrustedSender(event);
  if (jobWakeLockId !== null && powerSaveBlocker.isStarted(jobWakeLockId)) {
    return jobWakeLockId;
  }
  jobWakeLockId = powerSaveBlocker.start('prevent-app-suspension');
  return jobWakeLockId;
});

ipcMain.handle('power:releaseJobWakeLock', (event) => {
  assertTrustedSender(event);
  if (jobWakeLockId !== null && powerSaveBlocker.isStarted(jobWakeLockId)) {
    powerSaveBlocker.stop(jobWakeLockId);
  }
  jobWakeLockId = null;
});

ipcMain.handle('update:check', async (event): Promise<UpdateCheckResult> => {
  assertTrustedSender(event);
  if (isDev) return { ok: false, reason: 'not-packaged' };
  try {
    await autoUpdater.checkForUpdatesAndNotify();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'check-failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
});

ipcMain.handle(
  'update:install',
  (event, state?: { jobRunning?: boolean }): UpdateInstallResult => {
    assertTrustedSender(event);
    if (isDev) return { ok: false, reason: 'not-packaged' };
    if (state?.jobRunning === true || isJobWakeLockActive()) {
      return { ok: false, reason: 'job-running' };
    }
    try {
      autoUpdater.quitAndInstall();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: 'install-failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
);

// T2-35: Electron native serial IPC removed. The renderer uses Web Serial via
// MachineService/GrblController; keeping a parallel serialport bridge exposed
// unused connect/list/disconnect channels and confused the controller boundary.
// T1-27's serial:send bypass removal is subsumed here: no serial:* IPC remains.

ipcMain.handle('app:quit', (event) => {
  assertTrustedSender(event);
  app.quit();
});
