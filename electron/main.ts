// LaserForge 2.0 Electron main process.
//
// Security posture per PROJECT.md + audit fix F-9:
//   * contextIsolation: true
//   * nodeIntegration: false
//   * sandbox: true
//   * webSecurity: true
//   * permission handlers allow only serial, File System Access, screen
//     wake lock, and video-only media from the trusted renderer origin
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
  shell,
  type Event as ElectronEvent,
  type Session,
  type WebContents,
} from 'electron';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronUpdater from 'electron-updater';
import {
  serialPortDialogButtons,
  serialPortIdForDialogResponse,
  serialPortLabel,
  type ElectronSerialPortSummary,
} from './serial-port-choice.js';
import {
  resolveRendererRuntime,
  shouldAllowNavigation,
  shouldAllowWindowOpen,
  shouldGrantDevicePermission,
  shouldGrantPermissionCheck,
  shouldGrantPermissionRequest,
} from './trusted-renderer-policy.js';
import {
  CAMERA_BRIDGE_PORT,
  startLocalRtspCameraBridge,
  type RtspCameraBridgeHandle,
} from './rtsp-camera-bridge.js';
import { configureAutoUpdater } from './auto-update.js';
import { DESKTOP_PRODUCT_NAME, legacyDesktopDataPath } from './desktop-identity.js';
import {
  canonicalOfficialDesktopDownloadUrl,
  isOfficialDesktopDownloadUrl,
} from './official-download-page.js';
import {
  createPreviewUpdateCheck,
  isExactPreviewUpdateApiRequest,
  PREVIEW_UPDATE_API_PATH,
} from './preview-update.js';
import {
  readDesktopPreviewUpdateEnabled,
  readDesktopUpdateChannelTrust,
  resolveDesktopUpdateModes,
} from './update-channel-trust.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Public rename without a data migration: pin both Chromium/application roots
// before Electron's ready event so existing projects and recovery state remain.
const LEGACY_DESKTOP_DATA_PATH = legacyDesktopDataPath(app.getPath('appData'));
app.setName(DESKTOP_PRODUCT_NAME);
app.setPath('userData', LEGACY_DESKTOP_DATA_PATH);
app.setPath('sessionData', LEGACY_DESKTOP_DATA_PATH);

// electron-updater is CommonJS; under Node16 ESM the reliable interop is a
// default import + destructure (a named ESM import isn't statically detectable).
const { autoUpdater } = electronUpdater;

const RENDERER_RUNTIME = resolveRendererRuntime({
  devUrl: process.env['LASERFORGE_DEV_URL'],
  isPackaged: app.isPackaged,
});
const TRUSTED_RENDERER_ORIGINS = RENDERER_RUNTIME.trustedOrigins;
const CAMERA_BRIDGE_ORIGIN = `http://127.0.0.1:${CAMERA_BRIDGE_PORT}`;
// ADR-171: tag releases embed this flag only after forceCodeSigning succeeds.
// Missing, malformed, and manual-build metadata all fail closed.
const DESKTOP_UPDATE_MODES = resolveDesktopUpdateModes(
  readDesktopUpdateChannelTrust(app.getAppPath()),
  app.isPackaged && readDesktopPreviewUpdateEnabled(app.getAppPath()),
);
const IS_DESKTOP_UPDATE_CHANNEL_TRUSTED = DESKTOP_UPDATE_MODES.trustedUpdater;
const IS_DESKTOP_PREVIEW_UPDATE_ENABLED = DESKTOP_UPDATE_MODES.previewNotification;
const checkForPreviewUpdate = createPreviewUpdateCheck({
  enabled: IS_DESKTOP_PREVIEW_UPDATE_ENABLED,
  currentVersion: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  fetchReleases: (url, init) => net.fetch(url, init),
  onError: (error: unknown) => console.warn('Preview update check failed:', error),
});
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${CAMERA_BRIDGE_ORIGIN}`,
  "font-src 'self' data:",
  `connect-src 'self' ${CAMERA_BRIDGE_ORIGIN}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
let cameraBridge: RtspCameraBridgeHandle | null = null;

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
    if (url.hostname === 'app' && url.pathname === PREVIEW_UPDATE_API_PATH) {
      if (!isExactPreviewUpdateApiRequest(request)) {
        return new Response('Not Found', { status: 404 });
      }
      const availability = await checkForPreviewUpdate();
      return Response.json(availability, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
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
    title: DESKTOP_PRODUCT_NAME,
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
      isMainFrame: details.isMainFrame,
      currentUrl: wc?.getURL() ?? '',
    };
    return shouldGrantPermissionCheck(
      {
        ...baseInput,
        ...(details.mediaType === undefined ? {} : { mediaType: details.mediaType }),
        ...(details.embeddingOrigin === undefined
          ? {}
          : { embeddingOrigin: details.embeddingOrigin }),
      },
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
    const mediaTypes =
      'mediaTypes' in details && details.mediaTypes !== undefined ? details.mediaTypes : undefined;
    cb(
      shouldGrantPermissionRequest(
        {
          permission: String(permission),
          isMainFrame: details.isMainFrame,
          requestingUrl: details.requestingUrl,
          ...(mediaTypes === undefined ? {} : { mediaTypes }),
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
  // Use the always-provided `url` argument, not event.url — dereferencing
  // event.url (which can be undefined) throws inside the handler before
  // preventDefault runs, a fail-open on a security control. Guard will-redirect
  // too so a redirect to an untrusted origin can't slip past will-navigate
  // (ELE-07).
  const blockUntrusted = (event: { preventDefault: () => void }, url: string): void => {
    if (!shouldAllowNavigation(url, TRUSTED_RENDERER_ORIGINS)) {
      event.preventDefault();
    }
  };
  webContents.on('will-navigate', blockUntrusted);
  webContents.on('will-redirect', blockUntrusted);
  webContents.setWindowOpenHandler((details) => {
    if (isOfficialDesktopDownloadUrl(details.url)) {
      const downloadUrl = canonicalOfficialDesktopDownloadUrl(details.url);
      if (downloadUrl === null) return { action: 'deny' };
      void shell.openExternal(downloadUrl).catch((error: unknown) => {
        console.warn('Could not open the KerfDesk download page:', error);
      });
      return { action: 'deny' };
    }
    return {
      action: shouldAllowWindowOpen(details.url, TRUSTED_RENDERER_ORIGINS) ? 'allow' : 'deny',
    };
  });
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  await window.loadURL(RENDERER_RUNTIME.rendererUrl);
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
  //   img-src 'self' data: blob: + local camera bridge
  //                                - Vite-bundled images, blob URLs for
  //                                  image-loader.ts, and MJPEG previews from
  //                                  the loopback RTSP camera bridge.
  //   font-src 'self' data:        - Vite-bundled .ttf files via ?url import.
  //   connect-src 'self' + local camera bridge
  //                                - same-origin fetch plus the loopback RTSP
  //                                  bridge. No remote network service is
  //                                  allowed by Electron CSP.
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
  //
  // Browser camera setup uses Chromium's `media` permission. The policy helper
  // grants trusted main-frame video-only requests and keeps audio denied.
  //
  // Screen wake lock (ADR-117): useActiveJobWakeLock keeps the display awake
  // while a job streams so OS sleep can't stall Web Serial mid-burn. Electron
  // routes navigator.wakeLock.request('screen') through these handlers as
  // 'screen-wake-lock'; without the allowlist entry the request rejects and
  // keep-awake silently dies on the desktop build only.
  installPermissionHandlers(session.defaultSession);
  await loadRenderer(window);

  // Surface renderer console output to the main process stdout so dev runs
  // can see errors without having to open DevTools manually. Removed in the
  // packaged build via the app.isPackaged guard.
  installDevTools(window);

  window.once('ready-to-show', () => window.show());
}

async function startCameraBridgeSafely(): Promise<void> {
  try {
    cameraBridge = await startLocalRtspCameraBridge();
  } catch (err) {
    console.warn('RTSP camera bridge could not start:', err);
    cameraBridge = null;
  }
}

void app
  .whenReady()
  .then(async () => {
    // Wire the app:// scheme to the dist/web bundle before opening any
    // window. createWindow() will call loadURL('app://app/index.html'),
    // which fails fast if this handler isn't installed yet.
    const distRoot = path.join(__dirname, '..', 'dist', 'web');
    protocol.handle('app', makeAppProtocolHandler(distRoot));
    await startCameraBridgeSafely();
    // Background auto-update against our self-hosted feed (ADR-024/135). This is
    // inert until production artifacts are code-signed; once trusted, updates
    // install on quit and never mid-burn. Check errors are never fatal to startup.
    configureAutoUpdater(autoUpdater, {
      isPackaged: app.isPackaged,
      isChannelTrusted: IS_DESKTOP_UPDATE_CHANNEL_TRUSTED,
      onError: (error: unknown) => console.warn('Desktop update check failed:', error),
    });
    return createWindow();
  })
  .catch((err: unknown) => {
    console.error('Failed to create window:', err);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void cameraBridge?.close();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
