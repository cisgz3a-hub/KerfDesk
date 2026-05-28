// LaserForge 2.0 Electron main process.
//
// Security posture per PROJECT.md + audit fix F-9:
//   * contextIsolation: true
//   * nodeIntegration: false
//   * sandbox: true
//   * webSecurity: true
//   * setPermissionRequestHandler returns false except for `serial` (Phase B)
//   * CSP set via session.webRequest.onHeadersReceived (not meta tag —
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
//     URL — Vite dev server with HMR. CSP is loosened in that mode for HMR.
//   * Otherwise load app://app/index.html which the protocol handler maps
//     to dist/web/index.html. This is what `pnpm dev:desktop` and the
//     packaged build both do.

import { app, BrowserWindow, net, protocol, session } from 'electron';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_URL = process.env['LASERFORGE_DEV_URL'];

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

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
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

  // F-9 audit fix: set Content-Security-Policy via webRequest headers
  // rather than a <meta> tag. Per Electron docs, meta CSP is unreliable
  // on file:// origin and can't gate form-action / frame-ancestors.
  //
  // Policy rationale (each directive):
  //   default-src 'self'           — same-origin baseline; reject everything else.
  //   script-src 'self'            — bundled Vite scripts only; no inline JS, no eval.
  //   style-src 'self' 'unsafe-inline'
  //                                — React's `style={{ ... }}` prop emits inline styles
  //                                  on every element. 'unsafe-inline' is required.
  //                                  No third-party stylesheets are allowed.
  //   img-src 'self' data: blob:   — Vite-bundled images + blob URLs for
  //                                  image-loader.ts (raster image picker
  //                                  creates blobs from File objects).
  //   font-src 'self' data:        — Vite-bundled .ttf files via ?url import.
  //   connect-src 'self'           — same-origin fetch only (font assets); no
  //                                  outbound HTTP. Reinforces PROJECT.md
  //                                  "External services: None."
  //   object-src 'none'            — block <embed>/<object>/<applet> entirely.
  //   base-uri 'self'              — pin <base> tag to same-origin.
  //   form-action 'none'           — no form submissions anywhere.
  //   frame-ancestors 'none'       — refuse to be embedded.
  const CSP_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP_POLICY],
      },
    });
  });

  // Permission gate: deny everything by default, allow only what the app
  // actually uses.
  //
  // WebSerial (Phase B) needs four cooperating hooks; missing any of them
  // and the renderer's `navigator.serial.requestPort()` either errors
  // silently or never shows a picker:
  //   1) setPermissionCheckHandler   — accept 'serial' so the API isn't
  //      gated out before requestPort even fires.
  //   2) setDevicePermissionHandler  — approve serial-device grants per-device.
  //   3) select-serial-port event    — pick which port to return.
  //   4) setPermissionRequestHandler — accept 'serial' explicitly.
  //
  // File System Access (Phase A: SVG import, .lf2 save/open) is gated
  // on Electron 33+ via these same handlers. Chromium uses several
  // permission names for the API's sub-operations:
  //   'fileSystem'              — read via showOpenFilePicker → getFile
  //   'fileSystem-write'        — write via handle.createWritable
  //   'fileSystem-read-write'   — combined read/write request
  //   (future variants)         — Chrome ships new names occasionally
  // Allowing anything starting with 'fileSystem' covers all of them
  // and stays safe: all File System Access entry points require a
  // user gesture, so drive-by content can't trigger pickers.
  //
  // Electron 32 didn't route FileSystemFileHandle.getFile() through
  // these hooks at all; Electron 33+ does. F-2's bump to 42 surfaced
  // the gap.
  const isAllowedPermission = (permission: string): boolean =>
    permission === 'serial' || permission.startsWith('fileSystem');
  const ses = session.defaultSession;
  // setPermissionCheckHandler's permission type isn't exposed in Electron's
  // public type union (it's a wider string set than RequestHandler). The
  // (permission: string) cast below is verified against Electron docs.
  ses.setPermissionCheckHandler((_wc, permission) => {
    return isAllowedPermission(permission as string);
  });
  ses.setDevicePermissionHandler((details) => {
    return details.deviceType === 'serial';
  });
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(isAllowedPermission(permission as string));
  });
  // The `select-serial-port` event fires when the renderer calls
  // navigator.serial.requestPort(). The callback closes the loop with the
  // chosen port id (or '' to cancel). PortList contains every USB-serial
  // device currently visible to the OS.
  // The `select-serial-port` event signature isn't in @types/electron's
  // narrow event union, so we describe it locally and use `as never` at the
  // attach site to widen `ses.on`'s type to our shape.
  type ElectronSerialPort = {
    readonly portId: string;
    readonly portName: string;
    readonly displayName?: string;
    readonly vendorId?: string;
    readonly productId?: string;
    readonly serialNumber?: string;
    readonly usbDriverName?: string;
    readonly deviceInstanceId?: string;
  };
  const onSelectSerialPort = (
    event: Electron.Event,
    portList: ReadonlyArray<ElectronSerialPort>,
    _webContents: Electron.WebContents,
    callback: (portId: string) => void,
  ): void => {
    event.preventDefault();
    console.log(
      `[serial] select-serial-port fired; ${portList.length} port(s) visible to OS:`,
      portList.map((p) => ({
        portId: p.portId,
        portName: p.portName,
        vendorId: p.vendorId,
        productId: p.productId,
      })),
    );
    if (portList.length === 0) {
      console.log('[serial] No ports — is the laser plugged in and powered on?');
      callback('');
      return;
    }
    // Phase B initial: auto-pick the first port. Phase B polish replaces
    // this with a custom IPC-driven picker that surfaces portList to the
    // renderer's Laser panel and lets the user choose.
    const chosen = portList[0]?.portId ?? '';
    console.log(`[serial] Auto-picking port: ${chosen}`);
    callback(chosen);
  };
  (ses.on as unknown as (e: 'select-serial-port', l: typeof onSelectSerialPort) => void)(
    'select-serial-port',
    onSelectSerialPort,
  );

  if (DEV_URL !== undefined && DEV_URL.length > 0) {
    await window.loadURL(DEV_URL);
  } else {
    // A4 fix: load through the custom app:// scheme registered in
    // whenReady() below rather than file://. Both work; app:// gives
    // the renderer a predictable HTTPS-like origin that CSP and the
    // standard browser origin policies behave consistently against.
    await window.loadURL('app://app/index.html');
  }

  // Surface renderer console output to the main process stdout so dev runs
  // can see errors without having to open DevTools manually. Removed in the
  // packaged build via the app.isPackaged guard.
  if (!app.isPackaged) {
    window.webContents.on('console-message', (_event, level, message, line, source) => {
      console.log(`[renderer ${level}] ${source}:${line}  ${message}`);
    });
    window.webContents.openDevTools({ mode: 'detach' });
  }

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
