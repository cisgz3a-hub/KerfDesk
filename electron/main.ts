// LaserForge 2.0 Electron main process.
//
// Security posture per PROJECT.md + audit fix F-9:
//   * contextIsolation: true
//   * nodeIntegration: false
//   * sandbox: true
//   * webSecurity: true
//   * packaged BrowserWindows disable DevTools at creation
//   * the native application menu is explicit on every platform
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
  Menu,
  net,
  protocol,
  session,
  shell,
  type Session,
} from 'electron';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronUpdater from 'electron-updater';
import * as appMenu from './application-menu-policy.js';
import { mainWindowWebPreferences } from './desktop-window-options.js';
import {
  PACKAGED_RENDERER_URL,
  resolveRendererRuntime,
  shouldAllowNavigation,
  shouldAllowWindowOpen,
  shouldGrantPermissionCheck,
  shouldGrantPermissionRequest,
} from './trusted-renderer-policy.js';
import {
  CAMERA_BRIDGE_PORT,
  startLocalRtspCameraBridge,
  type RtspCameraBridgeHandle,
} from './rtsp-camera-bridge.js';
import { configureAutoUpdater } from './auto-update.js';
import { installApplicationFinalCleanup } from './application-final-cleanup.js';
import { desktopRuntimeIdentity } from './desktop-identity.js';
import * as nativeSmoke from './native-smoke.js';
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
import { installWindowReadinessPolicy } from './window-readiness-policy.js';
import { installDesktopWindowClose } from './desktop-window-close.js';
import { sessionPermissionsOnce } from './session-permissions-once.js';
import { installDesktopProjectOpens } from './desktop-project-open.js';
import { installDesktopSerialPorts } from './desktop-serial-ports.js';
import { externalBrowserUrl } from './external-links.js';
import { installDesktopContextMenu } from './desktop-context-menu.js';
import { loadWindowPlacement, rememberWindowPlacement } from './desktop-window-placement.js';
import { installRendererCrashRecovery } from './renderer-crash-recovery.js';
import { rendererContentSecurityPolicy } from './renderer-content-security-policy.js';
import { createDesktopWindowReopener } from './desktop-window-reopen.js';
import { createDesktopLicensing } from './desktop-licensing.js';
import { readLicensingConfig } from './licensing-config.js';
import { refusedDebugSwitch } from './debug-switch-policy.js';
import { startDesktopSupportLog } from './support-log.js';
import { installSessionEndGuard, withDesktopActivityRoute } from './session-end-guard.js';
import { installTaskbarJobProgress } from './taskbar-job-progress.js';
import { withSupportRoutes } from './support-routes.js';
import { withDesktopWindowCommands } from './desktop-window-commands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// A build that sells licences never loads its renderer under remote debugging
// (ADR-544). This runs before any window, route or single-instance handoff.
// Nor does it open DevTools or a development renderer, whatever `app.isPackaged`
// says: on Windows that only means the executable is not named electron.exe, and
// a per-user install folder is writable (ADR-544 Amendment 1).
const LICENSING_CONFIG = readLicensingConfig(app.getAppPath());
const SELLS_LICENCES = LICENSING_CONFIG.channel !== 'free';
const LOCKED_DOWN = app.isPackaged || SELLS_LICENCES;
const REFUSED_DEBUG_SWITCH = refusedDebugSwitch({
  sellsLicences: SELLS_LICENCES,
  argv: process.argv,
  hasSwitch: (name) => app.commandLine.hasSwitch(name),
});
if (REFUSED_DEBUG_SWITCH !== null) {
  dialog.showErrorBox(
    'KerfDesk',
    `KerfDesk does not start with the ${REFUSED_DEBUG_SWITCH} debugging option. Open KerfDesk from its shortcut instead.`,
  );
  app.exit(1);
}

// Public rename without a data migration: pin both Chromium/application roots
// before Electron's ready event so existing projects and recovery state remain.
const {
  name: DESKTOP_PRODUCT_NAME,
  appId: DESKTOP_APP_USER_MODEL_ID,
  dataPath: PROFILE_DATA_PATH,
} = desktopRuntimeIdentity(app.getPath('appData'), LICENSING_CONFIG);
const NATIVE_SMOKE_CONFIG = nativeSmoke.readNativeSmokeConfig(process.argv);
const DESKTOP_DATA_PATH = NATIVE_SMOKE_CONFIG?.userDataPath ?? PROFILE_DATA_PATH;
app.setName(DESKTOP_PRODUCT_NAME);
app.setPath('userData', DESKTOP_DATA_PATH);
app.setPath('sessionData', DESKTOP_DATA_PATH);
if (process.platform === 'win32') app.setAppUserModelId(DESKTOP_APP_USER_MODEL_ID);

let desktopWindowReady = false;
let quitRequested = false;
let prepareLicenceQuit: (() => void) | null = null;
const reopenDesktopWindow = createDesktopWindowReopener({
  isReady: () => desktopWindowReady,
  isQuitting: () => quitRequested,
  hasWindow: () => BrowserWindow.getAllWindows().some((window) => !window.isDestroyed()),
  createWindow,
  onError: (error: unknown) => console.error('Failed to reopen window:', error),
});

// One process owns the shared Chromium profile and the serial-capable UI. A
// second launch raises that primary window and hands over any project file it
// was asked to open (ADR-378).
const DESKTOP_PROJECT_OPENS = installDesktopProjectOpens(app, {
  isTrustedRenderer: (url) => shouldAllowNavigation(url, TRUSTED_RENDERER_ORIGINS),
  reopenWindow: reopenDesktopWindow,
});
const HAS_SINGLE_INSTANCE_LOCK = DESKTOP_PROJECT_OPENS.hasSingleInstanceLock;
if (!HAS_SINGLE_INSTANCE_LOCK) app.quit();

// A packaged app has no console: problems go to a local log that Help > Save
// Support Report reads (ADR-546). Only the primary instance writes it.
const SUPPORT_LOG = startDesktopSupportLog(app, DESKTOP_DATA_PATH, HAS_SINGLE_INSTANCE_LOCK);

function installApplicationMenu(): void {
  const template = appMenu.desktopApplicationMenuTemplate(process.platform);
  Menu.setApplicationMenu(template === null ? null : Menu.buildFromTemplate(template));
}

installApplicationMenu();

// electron-updater is CommonJS; under Node16 ESM the reliable interop is a
// default import + destructure (a named ESM import isn't statically detectable).
const { autoUpdater } = electronUpdater;

const RENDERER_RUNTIME = resolveRendererRuntime({
  devUrl: process.env['LASERFORGE_DEV_URL'],
  isPackaged: LOCKED_DOWN,
});
const TRUSTED_RENDERER_ORIGINS = RENDERER_RUNTIME.trustedOrigins;
const IS_DEV_SERVER_RENDERER = RENDERER_RUNTIME.rendererUrl !== PACKAGED_RENDERER_URL;
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
  fetchWorkflowRuns: (url, init) => net.fetch(url, init),
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
app.on('before-quit', () => {
  prepareLicenceQuit?.();
  quitRequested = true;
});
const installSessionPermissions = sessionPermissionsOnce(installPermissionHandlers);

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

function createMainWindow(bounds: ReturnType<typeof loadWindowPlacement>['bounds']): BrowserWindow {
  return new BrowserWindow({
    ...bounds,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#fafafa',
    title: DESKTOP_PRODUCT_NAME,
    webPreferences: mainWindowWebPreferences(appMenu.shouldEnableDesktopDevTools(LOCKED_DOWN)),
  });
}

function installContentSecurityPolicy(ses: Session): void {
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          rendererContentSecurityPolicy(CSP_POLICY, IS_DEV_SERVER_RENDERER),
        ],
      },
    });
  });
}

function installPermissionHandlers(ses: Session): void {
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    const baseInput = {
      permission: String(permission),
      requestingOrigin,
      isMainFrame: details.isMainFrame,
      currentUrl: wc === null ? null : wc.getURL(),
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
  // Only the picked port is granted, never every attached adapter (ADR-366);
  // Windows remembers the picks across restarts (ADR-552). Only the trusted
  // origin reaches the picker: requestPort is gated by the check handler above.
  installDesktopSerialPorts(ses, {
    trustedOrigins: TRUSTED_RENDERER_ORIGINS,
    userDataPath: DESKTOP_DATA_PATH,
  });
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
    // Other https links (Help > Report a Bug, preset sources, design licences)
    // open in the operator's browser, never as a second app window (ADR-482).
    const browserUrl = externalBrowserUrl(details.url);
    if (browserUrl !== null) {
      void shell.openExternal(browserUrl).catch((error: unknown) => {
        console.warn('Could not open the link in the browser:', error);
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
  if (LOCKED_DOWN) return;
  window.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    console.log(`[renderer ${level}] ${sourceId}:${lineNumber}  ${message}`);
  });
  window.webContents.openDevTools({ mode: 'detach' });
}

async function createWindow(): Promise<void> {
  const placement = loadWindowPlacement(app.getPath('userData'));
  const window = createMainWindow(placement.bounds);
  // Keep the qualification label visible even when the renderer updates its title.
  if (LICENSING_CONFIG.channel !== 'free' && LICENSING_CONFIG.sandbox === true)
    window.on('page-title-updated', (event) => {
      event.preventDefault();
    });
  installWindowReadinessPolicy(window, {
    reportFailure: (message) => dialog.showErrorBox('KerfDesk window error', message),
    reveal: () => (placement.maximized ? window.maximize() : window.show()),
  });
  rememberWindowPlacement(window, app.getPath('userData'));
  nativeSmoke.installPackagedNativeSmoke({ app, window, config: NATIVE_SMOKE_CONFIG });
  installNavigationPolicy(window);
  installDesktopContextMenu(window);
  const closeGuard = installDesktopWindowClose(window, {
    isTrustedRenderer: (url) => shouldAllowNavigation(url, TRUSTED_RENDERER_ORIGINS),
    isQuitRequested: () => quitRequested,
    cancelQuit: () => {
      quitRequested = false;
    },
    quit: () => app.quit(),
  });
  // Windows restarting or shutting down mid-job waits, or gets Abort (ADR-548),
  // and the taskbar button shows the job's progress (ADR-553).
  installSessionEndGuard(window);
  installTaskbarJobProgress(window);
  installRendererCrashRecovery(window, {
    isClosing: () => closeGuard.isClosing(),
    askToReload: async (prompt) => {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: [...prompt.buttons],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'KerfDesk',
        message: prompt.message,
        detail: prompt.detail,
      });
      return result.response === 0;
    },
    reportFailure: (error: unknown) => console.warn('Renderer reload offer failed:', error),
  });

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
  // WebSerial (Phase B) needs three cooperating hooks; missing any of them
  // and the renderer's `navigator.serial.requestPort()` either errors
  // silently or never shows a picker:
  //   1) setPermissionCheckHandler   - accept 'serial' so the API isn't
  //      gated out before requestPort even fires.
  //   2) select-serial-port event    - pick which port to return. Only that
  //      port is granted (ADR-366); on Windows the device permission handler
  //      grants the ports picked before and not forgotten (ADR-552).
  //   3) setPermissionRequestHandler - accept 'serial' explicitly.
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
  await loadRenderer(window);

  // Surface renderer console output to the main process stdout so dev runs
  // can see errors without having to open DevTools manually. Skipped in
  // packaged and licence-selling builds (LOCKED_DOWN).
  installDevTools(window);
}

async function startCameraBridgeSafely(): Promise<void> {
  try {
    cameraBridge = await startLocalRtspCameraBridge();
  } catch (err) {
    console.warn('RTSP camera bridge could not start:', err);
    cameraBridge = null;
  }
}

if (HAS_SINGLE_INSTANCE_LOCK && REFUSED_DEBUG_SWITCH === null)
  void app
    .whenReady()
    .then(async () => {
      await nativeSmoke.prepareNetwork(session.defaultSession, NATIVE_SMOKE_CONFIG);
      // Wire the app:// scheme to the dist/web bundle before opening any
      // window. createWindow() will call loadURL('app://app/index.html'),
      // which fails fast if this handler isn't installed yet.
      const distRoot = path.join(__dirname, '..', 'dist', 'web');
      autoUpdater.on('error', () => console.warn('Desktop updater reported an error.'));
      const licence = createDesktopLicensing({
        appPath: app.getAppPath(),
        userDataPath: DESKTOP_DATA_PATH,
        version: app.getVersion(),
        packaged: app.isPackaged,
        trustedUpdates: IS_DESKTOP_UPDATE_CHANNEL_TRUSTED,
        updater: autoUpdater,
      });
      prepareLicenceQuit = licence.prepareQuit;
      // The workspace, projects, serial ports and camera never wait on a licence:
      // every build opens, and Pro tools unlock only in the renderer (ADR-540).
      protocol.handle(
        'app',
        withDesktopWindowCommands(
          withDesktopActivityRoute(
            withSupportRoutes(
              licence.routes(DESKTOP_PROJECT_OPENS.routes(makeAppProtocolHandler(distRoot))),
              SUPPORT_LOG,
            ),
          ),
        ),
      );
      // A Session survives macOS window closure; install its listeners once,
      // before the first renderer, rather than adding another picker on reopen.
      installSessionPermissions(session.defaultSession);
      if (NATIVE_SMOKE_CONFIG === null) await startCameraBridgeSafely();
      // Background auto-update against our self-hosted feed (ADR-024/135). This is
      // inert until production artifacts are code-signed; once trusted, updates
      // install on quit after the application close handoff. This does not prove
      // the machine physically stopped. Check errors are never fatal to startup.
      configureAutoUpdater(autoUpdater, {
        isPackaged: app.isPackaged,
        isChannelTrusted: IS_DESKTOP_UPDATE_CHANNEL_TRUSTED && licence.config.channel === 'free',
        onError: (error: unknown) => console.warn('Desktop update check failed:', error),
      });
      await createWindow();
      desktopWindowReady = true;
      licence.start();
    })
    .catch((err: unknown) => {
      console.error('Failed to create window:', err);
      app.exit(1);
    });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

installApplicationFinalCleanup(app, () => cameraBridge?.close(), {
  reportFailure: (error: unknown) => console.warn('RTSP camera bridge cleanup failed:', error),
});

app.on('activate', reopenDesktopWindow);
