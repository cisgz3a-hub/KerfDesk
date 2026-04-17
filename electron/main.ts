import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { listSerialPorts, openSerial, closeSerial, safeCloseSerial, writeSerialLine } from './serial';

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

let safeShutdownDone = false;

app.on('before-quit', (e) => {
  if (safeShutdownDone) return;
  e.preventDefault();
  safeShutdownDone = true;
  killBridge();
  safeCloseSerial()
    .catch(err => console.error('[before-quit] safe close failed:', err))
    .finally(() => app.quit());
});

// ─── WAINLUX BRIDGE AUTO-SPAWN ──────────────────────────────────

let bridgeProcess: ChildProcess | null = null;

function killBridge() {
  if (bridgeProcess) {
    console.log('[bridge] Stopping bridge process');
    bridgeProcess.kill();
    bridgeProcess = null;
  }
}

ipcMain.handle('bridge:start', async (_event, laserIp: string, wsPort: number) => {
  killBridge();

  const scriptPath = path.join(app.getAppPath(), 'scripts', 'wainlux-bridge.mjs');
  if (!fs.existsSync(scriptPath)) {
    console.error('[bridge] Script not found:', scriptPath);
    return { ok: false as const, error: 'Bridge script not found' };
  }

  console.log(`[bridge] Spawning: node ${scriptPath} ${laserIp} --ws-port ${wsPort}`);
  bridgeProcess = spawn('node', [scriptPath, laserIp, '--ws-port', String(wsPort)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  bridgeProcess.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log('[bridge]', line);
  });

  bridgeProcess.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.error('[bridge]', line);
  });

  bridgeProcess.on('exit', (code) => {
    console.log(`[bridge] Process exited with code ${code}`);
    bridgeProcess = null;
  });

  await new Promise<void>(resolve => {
    setTimeout(resolve, 600);
  });
  return { ok: true as const };
});

ipcMain.handle('bridge:stop', async () => {
  killBridge();
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
