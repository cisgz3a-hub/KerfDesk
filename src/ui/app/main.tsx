// Web + Electron entry point. Mounts the React tree into #app-root.
// The same web adapter serves both targets — Electron's Chromium renderer has
// the same Web Serial / File System Access / getUserMedia APIs (granted in
// electron/main.ts). We only stamp `id: 'electron'` for UI feature-gating.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createDesktopPreviewUpdateAdapter, isElectronRenderer } from '../../platform/electron';
import type { PlatformAdapter } from '../../platform/types';
import { webAdapter } from '../../platform/web';
import { ErrorBoundary, type SoftwareAbort } from '../common/ErrorBoundary';
import { startPagedAssetReconciliation } from '../import/paged-asset-startup';
import { watchPagedRasterOwnership } from '../import/paged-raster-ownership-watch';
import { isActiveJob } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
// Design tokens + shared chrome classes (ADR-047). Imported exactly once,
// here — jsdom tests never load main.tsx, so styling stays out of unit tests.
import '../theme/tokens.css';
import { initAppTheme } from '../theme/app-theme';
import { App } from './App';
import { PlatformProvider } from './platform-context';

const rootElement = document.getElementById('app-root');
if (rootElement === null) {
  throw new Error('Root element #app-root not found in index.html.');
}

// Stamp the saved theme on <html> BEFORE the first render, so the chrome never
// paints a frame in one theme and then flips (ADR-339).
initAppTheme();

startPagedAssetReconciliation();
watchPagedRasterOwnership();

// Reuse every web-adapter method; only override `id` so the UI can hide the
// browser-only PWA install + desktop-download affordances inside the app.
const adapter: PlatformAdapter = isElectronRenderer()
  ? { ...webAdapter, id: 'electron', desktopUpdates: createDesktopPreviewUpdateAdapter() }
  : webAdapter;

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
      s.fireActive
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
        <App />
      </PlatformProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Static HTML supplies the wordmark and indeterminate loader before JS arrives.
// Give the mounted canvas one paint opportunity, then reveal the workspace
// without an artificial hold. Keep the fallback for startup render failures.
// The fade duration matches index.html; reduced motion removes it immediately.
const SPLASH_FADE_MS = 180;
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
  splash.classList.add(SPLASH_HIDDEN_CLASS);
  const remove = (): void => splash.remove();
  splash.addEventListener('transitionend', remove, { once: true });
  // Fallback: reduced-motion (no transition) or a missed transitionend.
  window.setTimeout(remove, SPLASH_FADE_MS);
}

function dismissWhenBoardReady(): void {
  const boardMounted = document.querySelector('#app-root canvas') !== null;
  const startupCrashed = document.querySelector('#app-root > [role="alert"]') !== null;
  const timedOut = performance.now() - splashStartedAt > SPLASH_MAX_WAIT_MS;
  if (boardMounted || startupCrashed || timedOut) {
    requestAnimationFrame(fadeOutSplash);
    return;
  }
  requestAnimationFrame(dismissWhenBoardReady);
}

requestAnimationFrame(dismissWhenBoardReady);
