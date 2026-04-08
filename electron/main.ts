import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { listSerialPorts, openSerial, closeSerial, writeSerialLine } from './serial';

let mainWindow: BrowserWindow | null = null;

/** Dev: unpackaged app, or explicit --dev (Vite on localhost:3000) */
const isDev = !app.isPackaged || process.argv.includes('--dev');

// Enable Web Serial API in Electron
app.commandLine.appendSwitch('enable-features', 'ElectronSerialChooser,WebSerial');

app.on('web-contents-created', (_, contents) => {
  contents.session.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();
    // Show all available ports — user picks in the browser dialog
    if (portList && portList.length > 0) {
      callback(portList[0].portId);
    } else {
      callback('');
    }
  });

  contents.session.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'serial') return true;
    return true;
  });

  contents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'serial') return true;
    return true;
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
    },
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

app.on('before-quit', () => {
  void closeSerial();
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

ipcMain.handle('serial:send', async (_event, line: string) => {
  await writeSerialLine(line);
});
