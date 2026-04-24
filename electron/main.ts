import { app, BrowserWindow, ipcMain, dialog, powerSaveBlocker } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { listSerialPorts, openSerial, closeSerial, safeCloseSerial, writeSerialLine } from './serial';
import { registerFalconWiFiIpc, shutdownFalconWiFi } from './falcon-wifi';
import { storageGet, storageSet, storageRemove, storageList, storageClear } from './storage';

let mainWindow: BrowserWindow | null = null;

/** Dev: unpackaged app, or explicit --dev (Vite on localhost:3000) */
const isDev = !app.isPackaged || process.argv.includes('--dev');

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
      webviewTag: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  // Content Security Policy — reduces XSS impact in the renderer
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: indexeddb:",
            "font-src 'self' data:",
            "connect-src 'self' ws: wss: https:",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "frame-src 'none'",
            "base-uri 'self'",
          ].join('; '),
        ],
      },
    });
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

registerFalconWiFiIpc(() => mainWindow);

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

let safeShutdownDone = false;

/** OS wake lock id while a job is active (see power:acquireJobWakeLock). */
let jobWakeLockId: number | null = null;

app.on('before-quit', (e) => {
  if (safeShutdownDone) return;
  e.preventDefault();
  safeShutdownDone = true;
  if (jobWakeLockId !== null && powerSaveBlocker.isStarted(jobWakeLockId)) {
    powerSaveBlocker.stop(jobWakeLockId);
    jobWakeLockId = null;
  }
  shutdownFalconWiFi();
  safeCloseSerial()
    .catch(err => console.error('[before-quit] safe close failed:', err))
    .finally(() => app.quit());
});

// ─── NATIVE FILE DIALOGS ─────────────────────────────────────────

ipcMain.handle('dialog:save', async (_event, defaultName: string, content: string) => {
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

ipcMain.handle('dialog:saveGcode', async (_event, defaultName: string, content: string) => {
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

ipcMain.handle('dialog:open', async () => {
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
  const content = fs.readFileSync(filePath, 'utf-8');
  return { filePath, content, ext: path.extname(filePath).toLowerCase() };
});

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertOptionalString(value: unknown, label: string): asserts value is string | undefined {
  if (value != null && typeof value !== 'string') {
    throw new Error(`Invalid ${label}`);
  }
}

ipcMain.handle('storage:get', (_event, key: unknown) => {
  assertNonEmptyString(key, 'storage key');
  return storageGet(key);
});

ipcMain.handle('storage:set', (_event, key: unknown, value: unknown) => {
  assertNonEmptyString(key, 'storage key');
  if (typeof value !== 'string') throw new Error('Invalid storage value');
  storageSet(key, value);
});

ipcMain.handle('storage:remove', (_event, key: unknown) => {
  assertNonEmptyString(key, 'storage key');
  storageRemove(key);
});

ipcMain.handle('storage:list', (_event, prefix: unknown) => {
  assertOptionalString(prefix, 'storage prefix');
  return storageList(prefix);
});

ipcMain.handle('storage:clear', () => {
  storageClear();
});

// ─── WAKE LOCK ───────────────────────────────────────────────────
// Held during active jobs so Windows doesn't suspend USB,
// Chromium doesn't throttle our renderer, and the OS doesn't
// sleep. Released on all job-end paths.

ipcMain.handle('power:acquireJobWakeLock', () => {
  if (jobWakeLockId !== null && powerSaveBlocker.isStarted(jobWakeLockId)) {
    return jobWakeLockId;
  }
  jobWakeLockId = powerSaveBlocker.start('prevent-app-suspension');
  return jobWakeLockId;
});

ipcMain.handle('power:releaseJobWakeLock', () => {
  if (jobWakeLockId !== null && powerSaveBlocker.isStarted(jobWakeLockId)) {
    powerSaveBlocker.stop(jobWakeLockId);
  }
  jobWakeLockId = null;
});

// ─── SERIAL / GRBL ───────────────────────────────────────────────

ipcMain.handle('serial:list', async () => listSerialPorts());

ipcMain.handle('serial:connect', async (_event, portPath: string, baudRate: number) => {
  if (portPath === 'SIMULATOR') return false;
  return openSerial(portPath, baudRate);
});

ipcMain.handle('serial:disconnect', async () => {
  await closeSerial();
});

ipcMain.handle('serial:send', async (_event, line: unknown) => {
  if (typeof line !== 'string') return;
  if (line.length === 0 || line.length > 127) return;
  if (/[\r\n]/.test(line)) return;
  await writeSerialLine(line);
});

ipcMain.handle('app:quit', () => {
  app.quit();
});
