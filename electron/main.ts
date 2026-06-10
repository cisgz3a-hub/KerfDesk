// LaserForge 2.0 Electron main process.
//
// Security posture per PROJECT.md + audit fix F-9:
//   * contextIsolation: true
//   * nodeIntegration: false
//   * sandbox: true
//   * webSecurity: true
//   * permission handlers allow only serial / File System Access from the
//     trusted renderer origin
//   * navigation and renderer-created windows are locked to the trusted
//     renderer origin
//   * CSP set via session.webRequest.onHeadersReceived (not meta tag -
//     per Electron docs, meta CSP is unreliable on file:// origin and
//     can't gate things like form-action / frame-ancestors)
//   * Renderer runs on the custom `app://` scheme via protocol.handle()
//     instead of file:// (A4 audit fix). Gives the renderer a predictable
//     origin so CSP behaves consistently and the cross-origin-isolation
//     defaults match a normal HTTPS site rather than file://'s special
//     case. Path traversal is blocked by re-resolving every request and
//     refusing anything outside the dist/web bundle root.
//
// Renderer source:
//   * If env LASERFORGE_DEV_URL is set (e.g. http://localhost:5173), load that
//     URL - Vite dev server. NOTE (LU26): the frozen CSP_POLICY below is
//     applied unconditionally, dev included - there is no HMR loosening, so
//     dev:desktop HMR features that need eval/ws may not work under it.
//   * Otherwise load app://app/index.html which the protocol handler maps
//     to dist/web/index.html. This is what `pnpm dev:desktop` and the
//     packaged build both do.

import {
  app,
  BrowserWindow,
  dialog,
  net,
  protocol,
  session,
  type Event as ElectronEvent,
  type Session,
  type WebContents,
} from 'electron';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  serialPortDialogButtons,
  serialPortIdForDialogResponse,
  serialPortLabel,
  type ElectronSerialPortSummary,
} from './serial-port-choice.js';
import {
  makeTrustedRendererOrigins,
  shouldAllowNavigation,
  shouldAllowWindowOpen,
  shouldGrantDevicePermission,
  shouldGrantPermissionCheck,
  shouldGrantPermissionRequest,
} from './trusted-renderer-policy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_URL = process.env['LASERFORGE_DEV_URL'];
const TRUSTED_RENDERER_ORIGINS = makeTrustedRendererOrigins(DEV_URL);
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

type ElectronSerialPort = ElectronSerialPortSummary & {
  readonly vendorId?: string;
  readonly productId?: string;
  readonly serialNumber?: string;
  readonly usbDriverName?: string;
  readonly deviceInstanceId?: string;
};

// Custom-scheme registration MUST happen before app.whenReady(). Per the
// Electron security checklist, declaring `standard: true` + `secure: true`
// makes the renderer behave like an HTTPS origin (fetch / SubtleCrypto /
// SharedArrayBuffer all work the same as on real HTTPS). `supportFetchAPI`
// lets renderer code `fetch('app://...')` for additional assets if needed.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

// Maps an `app://app/<path>` URL onto a file under dist/web. Refuses any
// resolved path that escapes the bundle root (e.g. ../../etc/passwd).
function makeAppProtocolHandler(distRoot: string) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    // Strip leading slash; treat empty path as index.html.
    const requested = url.pathname.replace(/^\/+/, '') || 'index.html';
    const filePath = path.normalize(path.join(distRoot, requested));
    // Path-traversal guard: after normalize, the path must still live
    // inside distRoot. path.relative returns '' or a non-'..' string
    // when within; '..'-prefixed otherwise.
    const rel = path.relative(distRoot, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return new Response('Not Found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  };
}

function createMainWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#fafafa',
    title: 'LaserForge 2.0',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
}

function installContentSecurityPolicy(ses: Session): void {
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP_POLICY],
      },
    });
  });
}

async function chooseSerialPortId(
  webContents: WebContents,
  portList: ReadonlyArray<ElectronSerialPort>,
): Promise<string> {
  if (portList.length === 0) {
    console.log('[serial] No ports - is the laser plugged in and powered on?');
    return '';
  }
  const buttons = serialPortDialogButtons(portList);
  const owner = BrowserWindow.fromWebContents(webContents) ?? undefined;
  const options = {
    type: 'question' as const,
    buttons: [...buttons],
    cancelId: buttons.length - 1,
    defaultId: 0,
    noLink: true,
    message: 'Select laser serial port',
    detail: portList.map((port, i) => `${i + 1}. ${serialPortLabel(port)}`).join('\n'),
  };
  const result =
    owner === undefined
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(owner, options);
  return serialPortIdForDialogResponse(portList, result.response);
}

function logSerialPorts(portList: ReadonlyArray<ElectronSerialPort>): void {
  console.log(
    `[serial] select-serial-port fired; ${portList.length} port(s) visible to OS:`,
    portList.map((p) => ({
      portId: p.portId,
      portName: p.portName,
      vendorId: p.vendorId,
      productId: p.productId,
    })),
  );
}

function handleSelectSerialPort(
  event: ElectronEvent,
  portList: ReadonlyArray<ElectronSerialPort>,
  webContents: WebContents,
  callback: (portId: string) => void,
): void {
  event.preventDefault();
  logSerialPorts(portList);
  void chooseSerialPortId(webContents, portList)
    .then((chosen) => {
      console.log(
        chosen === '' ? '[serial] Port selection cancelled.' : `[serial] Selected port: ${chosen}`,
      );
      callback(chosen);
    })
    .catch((err: unknown) => {
      console.error('Serial port picker failed:', err);
      callback('');
    });
}

function installPermissionHandlers(ses: Session): void {
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    const baseInput = {
      permission: String(permission),
      requestingOrigin,
      currentUrl: wc?.getURL() ?? '',
    };
    return shouldGrantPermissionCheck(
      details.embeddingOrigin === undefined
        ? baseInput
        : { ...baseInput, embeddingOrigin: details.embeddingOrigin },
      TRUSTED_RENDERER_ORIGINS,
    );
  });
  ses.setDevicePermissionHandler((details) => {
    return shouldGrantDevicePermission(
      { deviceType: details.deviceType, origin: details.origin },
      TRUSTED_RENDERER_ORIGINS,
    );
  });
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(
      shouldGrantPermissionRequest(
        {
          permission: String(permission),
          isMainFrame: details.isMainFrame,
          requestingUrl: details.requestingUrl,
          currentUrl: wc.getURL(),
        },
        TRUSTED_RENDERER_ORIGINS,
      ),
    );
  });
  const onSelectSerialPort = (
    event: ElectronEvent,
    portList: ReadonlyArray<ElectronSerialPort>,
    webContents: WebContents,
    callback: (portId: string) => void,
  ): void => {
    handleSelectSerialPort(event, portList, webContents, callback);
  };
  (ses.on as unknown as (e: 'select-serial-port', l: typeof onSelectSerialPort) => void)(
    'select-serial-port',
    onSelectSerialPort,
  );
}

function installNavigationPolicy(window: BrowserWindow): void {
  const webContents = window.webContents;
  webContents.on('will-navigate', (event, url) => {
    const targetUrl = event.url.length > 0 ? event.url : url;
    if (!shouldAllowNavigation(targetUrl, TRUSTED_RENDERER_ORIGINS)) {
      event.preventDefault();
    }
  });
  webContents.setWindowOpenHandler((details) => {
    return {
      action: shouldAllowWindowOpen(details.url, TRUSTED_RENDERER_ORIGINS) ? 'allow' : 'deny',
    };
  });
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (DEV_URL !== undefined && DEV_URL.length > 0) {
    await window.loadURL(DEV_URL);
  } else {
    await window.loadURL('app://app/index.html');
  }
}

function installDevTools(window: BrowserWindow): void {
  if (app.isPackaged) return;
  window.webContents.on('console-message', (_event, level, message, line, source) => {
    console.log(`[renderer ${level}] ${source}:${line}  ${message}`);
  });
  window.webContents.openDevTools({ mode: 'detach' });
}

async function createWindow(): Promise<void> {
  const window = createMainWindow();
  installNavigationPolicy(window);

  // F-9 audit fix: set Content-Security-Policy via webRequest headers
  // rather than a <meta> tag. Per Electron docs, meta CSP is unreliable
  // on file:// origin and can't gate form-action / frame-ancestors.
  //
  // Policy rationale (each directive):
  //   default-src 'self'           - same-origin baseline; reject everything else.
  //   script-src 'self'            - bundled Vite scripts only; no inline JS, no eval.
  //   worker-src 'self' data: blob:
  //                                - Vite emits the trace worker as a module worker
  //                                  URL; allow that off-thread trace path while
  //                                  keeping all other worker origins blocked.
  //   style-src 'self' 'unsafe-inline'
  //                                - React's `style={{ ... }}` prop emits inline styles
  //                                  on every element. 'unsafe-inline' is required.
  //                                  No third-party stylesheets are allowed.
  //   img-src 'self' data: blob:   - Vite-bundled images + blob URLs for
  //                                  image-loader.ts (raster image picker
  //                                  creates blobs from File objects).
  //   font-src 'self' data:        - Vite-bundled .ttf files via ?url import.
  //   connect-src 'self'           - same-origin fetch only (font assets); no
  //                                  outbound HTTP. Reinforces PROJECT.md
  //                                  "External services: None."
  //   object-src 'none'            - block <embed>/<object>/<applet> entirely.
  //   base-uri 'self'              - pin <base> tag to same-origin.
  //   form-action 'none'           - no form submissions anywhere.
  //   frame-ancestors 'none'       - refuse to be embedded.
  installContentSecurityPolicy(session.defaultSession);

  // Permission gate: deny everything by default, allow only what the app
  // actually uses.
  //
  // WebSerial (Phase B) needs four cooperating hooks; missing any of them
  // and the renderer's `navigator.serial.requestPort()` either errors
  // silently or never shows a picker:
  //   1) setPermissionCheckHandler   - accept 'serial' so the API isn't
  //      gated out before requestPort even fires.
  //   2) setDevicePermissionHandler  - approve serial-device grants per-device.
  //   3) select-serial-port event    - pick which port to return.
  //   4) setPermissionRequestHandler - accept 'serial' explicitly.
  //
  // File System Access (Phase A: SVG import, .lf2 save/open) is gated
  // on Electron 33+ via these same handlers. Chromium uses several
  // permission names for the API's sub-operations:
  //   'fileSystem'              - read via showOpenFilePicker -> getFile
  //   'fileSystem-write'        - write via handle.createWritable
  //   'fileSystem-read-write'   - combined read/write request
  //   (future variants)         - Chrome ships new names occasionally
  // Allowing anything starting with 'fileSystem' covers all of them
  // and stays safe: all File System Access entry points require a
  // user gesture, so drive-by content can't trigger pickers.
  //
  // Electron 32 didn't route FileSystemFileHandle.getFile() through
  // these hooks at all; Electron 33+ does. F-2's bump to 42 surfaced
  // the gap.
  installPermissionHandlers(session.defaultSession);
  await loadRenderer(window);

  // Surface renderer console output to the main process stdout so dev runs
  // can see errors without having to open DevTools manually. Removed in the
  // packaged build via the app.isPackaged guard.
  installDevTools(window);

  window.once('ready-to-show', () => window.show());
}

void app
  .whenReady()
  .then(() => {
    // Wire the app:// scheme to the dist/web bundle before opening any
    // window. createWindow() will call loadURL('app://app/index.html'),
    // which fails fast if this handler isn't installed yet.
    const distRoot = path.join(__dirname, '..', 'dist', 'web');
    protocol.handle('app', makeAppProtocolHandler(distRoot));
    return createWindow();
  })
  .catch((err: unknown) => {
    console.error('Failed to create window:', err);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
