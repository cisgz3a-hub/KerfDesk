// Web + Electron entry point. Mounts the React tree into #app-root.
// The same web adapter serves both targets — Electron's Chromium renderer has
// the same Web Serial / File System Access / getUserMedia APIs (granted in
// electron/main.ts). We only stamp `id: 'electron'` for UI feature-gating.

import { StrictMode } from 'react';
import { resolveWindowsDesktopDownload } from '../../../public/desktop-windows-download.mjs';
import { DesktopDownloadContext } from '../licensing/desktop-download-context';
import { createRoot } from 'react-dom/client';
import {
  createDesktopPreviewUpdateAdapter,
  createDesktopLicenceAdapter,
  createDesktopProjectFiles,
  createDesktopJobActivityReporter,
  createDesktopSerialAdapter,
  createDesktopSupportLogReader,
  createDesktopWindowCommands,
  isElectronRenderer,
} from '../../platform/electron';
import type { PlatformAdapter } from '../../platform/types';
import { webAdapter } from '../../platform/web';
import { ErrorBoundary, type SoftwareAbort } from '../common/ErrorBoundary';
import { startPagedAssetReconciliation } from '../import/paged-asset-startup';
import { watchPagedRasterOwnership } from '../import/paged-raster-ownership-watch';
import { isActiveJob } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { unownedControllerMotion } from '../state/unowned-controller-motion';
// Design tokens + shared chrome classes (ADR-047). Imported exactly once,
// here — jsdom tests never load main.tsx, so styling stays out of unit tests.
import '../theme/tokens.css';
import { initAppTheme } from '../theme/app-theme';
import { App } from './App';
import { PlatformProvider } from './platform-context';
import { EditionProvider } from '../licensing/EditionProvider';
import { watchPreloadErrors } from './preload-error-toast';

const rootElement = document.getElementById('app-root');
if (rootElement === null) {
  throw new Error('Root element #app-root not found in index.html.');
}

// Stamp the saved theme on <html> BEFORE the first render, so the chrome never
// paints a frame in one theme and then flips (ADR-339).
initAppTheme();

startPagedAssetReconciliation();
watchPagedRasterOwnership();
// Before anything lazy loads: a chunk gone after an update in another window
// gets one advisory toast, and nothing reloads by itself (ADR-060).
watchPreloadErrors();

// Reuse every web-adapter method; override `id` so the UI can hide the
// browser-only PWA install + desktop-download affordances inside the app. The
// desktop app also reopens files Explorer handed over, by path (ADR-378).
const adapter: PlatformAdapter = isElectronRenderer()
  ? {
      ...webAdapter,
      id: 'electron',
      serial: createDesktopSerialAdapter(webAdapter.serial),
      desktopUpdates: createDesktopPreviewUpdateAdapter(),
      ...createDesktopProjectFiles(webAdapter.recentFiles, {
        handleSaveTarget: webAdapter.openedProjectSaveTarget,
      }),
      // The main process serves its support log (ADR-546), takes job reports
      // (ADR-548) and runs File > Exit (ADR-554) only on app://.
      ...(window.location.protocol === 'app:'
        ? {
            readSupportLog: createDesktopSupportLogReader(),
            reportJobActivity: createDesktopJobActivityReporter(),
            desktopWindow: createDesktopWindowCommands(),
          }
        : {}),
    }
  : webAdapter;
const desktopLicenceClient =
  adapter.id === 'electron' && window.location.protocol === 'app:'
    ? createDesktopLicenceAdapter()
    : undefined;

// If a render crash unmounts the App (and its Abort button + Ctrl+. listener),
// the crash screen still needs a way to request a controller abort (F60/F65). Both
// closures read the store at call time, so they reflect the machine's real state
// at the moment of the crash / click.
const softwareAbort: SoftwareAbort = {
  isMotionLive: () => {
    const s = useLaserStore.getState();
    return (
      isActiveJob(s.streamer) ||
      s.controllerOperation !== null ||
      s.motionOperation !== null ||
      s.fireActive ||
      unownedControllerMotion(s) !== null
    );
  },
  trigger: () =>
    void useLaserStore
      .getState()
      .stopJob()
      .catch(() => undefined),
};

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary softwareAbort={softwareAbort}>
      <PlatformProvider adapter={adapter}>
        <DesktopDownloadContext.Provider value={resolveWindowsDesktopDownload}>
          <EditionProvider
            {...(import.meta.env.DEV && import.meta.env.MODE === 'test'
              ? { unlicensedRunsFree: false }
              : {})}
            {...(desktopLicenceClient === undefined ? {} : { client: desktopLicenceClient })}
          >
            <App />
          </EditionProvider>
        </DesktopDownloadContext.Provider>
      </PlatformProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Static HTML supplies the wordmark and indeterminate loader before JS arrives.
// Give the successfully drawn workspace one paint opportunity, then reveal it.
// The web app reveals at once. The desktop app, which loads from disk in a
// fraction of a second, holds the screen for a short minimum from launch and
// fades it slowly so it reads as a loading screen, not a flash (ADR-049
// Amendment 1). A startup crash is always revealed immediately, and reduced
// motion removes the fade.
const DESKTOP_STARTUP = adapter.id === 'electron';
const SPLASH_MIN_VISIBLE_MS = DESKTOP_STARTUP ? 2000 : 0;
const SPLASH_FADE_MS = DESKTOP_STARTUP ? 500 : 180;
const SPLASH_MAX_WAIT_MS = 5000;
const SPLASH_HIDDEN_CLASS = 'app-splash--hidden';
const splashStartedAt = performance.now();

function fadeOutSplash(): void {
  const splash = document.getElementById('app-splash');
  if (splash === null) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splash.remove();
    return;
  }
  // index.html's rule carries the web duration; the desktop fade is longer.
  splash.style.transitionDuration = `${SPLASH_FADE_MS}ms`;
  splash.classList.add(SPLASH_HIDDEN_CLASS);
  const remove = (): void => splash.remove();
  splash.addEventListener('transitionend', remove, { once: true });
  // Fallback: reduced-motion (no transition) or a missed transitionend.
  window.setTimeout(remove, SPLASH_FADE_MS + 50);
}

function dismissWhenBoardReady(): void {
  const boardPainted =
    document.querySelector('#app-root canvas[data-workspace-painted="true"]') !== null;
  const startupCrashed = document.querySelector('#app-root > [role="alert"]') !== null;
  const timedOut = performance.now() - splashStartedAt > SPLASH_MAX_WAIT_MS;
  // performance.now() counts from navigation, when the static splash first paints.
  const heldLongEnough = performance.now() >= SPLASH_MIN_VISIBLE_MS;
  if (startupCrashed || ((boardPainted || timedOut) && heldLongEnough)) {
    requestAnimationFrame(fadeOutSplash);
    return;
  }
  requestAnimationFrame(dismissWhenBoardReady);
}

requestAnimationFrame(dismissWhenBoardReady);
