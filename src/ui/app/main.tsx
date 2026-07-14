// Web + Electron entry point. Mounts the React tree into #app-root.
// The same web adapter serves both targets — Electron's Chromium renderer has
// the same Web Serial / File System Access / getUserMedia APIs (granted in
// electron/main.ts). We only stamp `id: 'electron'` for UI feature-gating.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isElectronRenderer } from '../../platform/electron';
import type { PlatformAdapter } from '../../platform/types';
import { webAdapter } from '../../platform/web';
import { ErrorBoundary, type EmergencyStop } from '../common/ErrorBoundary';
import { isActiveJob } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
// Design tokens + shared chrome classes (ADR-047). Imported exactly once,
// here — jsdom tests never load main.tsx, so styling stays out of unit tests.
import '../theme/tokens.css';
import { App } from './App';
import { PlatformProvider } from './platform-context';

const rootElement = document.getElementById('app-root');
if (rootElement === null) {
  throw new Error('Root element #app-root not found in index.html.');
}

// Reuse every web-adapter method; only override `id` so the UI can hide the
// browser-only PWA install + desktop-download affordances inside the app.
const adapter: PlatformAdapter = isElectronRenderer()
  ? { ...webAdapter, id: 'electron' }
  : webAdapter;

// If a render crash unmounts the App (and its Stop button + Ctrl+. listener),
// the crash screen still needs a way to halt live motion (F60/F65). Both
// closures read the store at call time, so they reflect the machine's real state
// at the moment of the crash / click.
const emergencyStop: EmergencyStop = {
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
    <ErrorBoundary emergencyStop={emergencyStop}>
      <PlatformProvider adapter={adapter}>
        <App />
      </PlatformProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// The startup splash (index.html) is a full black loading screen with the
// KerfDesk banner. It paints immediately from static HTML, covering the page
// while the bundle loads. Here we hold it until the workspace CANVAS has
// painted, a short beat, then fade the whole screen OUT — background and
// banner together — to reveal the app. A hard max-wait dismisses it even if
// the canvas never appears. (Timing this from an inline <script> would be
// blocked by the CSP anyway.)
const SPLASH_HOLD_MS = 700;
const SPLASH_FADE_MS = 700;
const SPLASH_MAX_WAIT_MS = 5000;
const SPLASH_HIDDEN_CLASS = 'app-splash--hidden';
const splashStartedAt = performance.now();

function fadeOutSplash(): void {
  const splash = document.getElementById('app-splash');
  if (splash === null) return;
  splash.classList.add(SPLASH_HIDDEN_CLASS);
  const remove = (): void => splash.remove();
  splash.addEventListener('transitionend', remove, { once: true });
  // Fallback: reduced-motion (no transition) or a missed transitionend.
  window.setTimeout(remove, SPLASH_FADE_MS);
}

function dismissWhenBoardReady(): void {
  const boardPainted = document.querySelector('#app-root canvas') !== null;
  const timedOut = performance.now() - splashStartedAt > SPLASH_MAX_WAIT_MS;
  if (boardPainted || timedOut) {
    window.setTimeout(fadeOutSplash, SPLASH_HOLD_MS);
    return;
  }
  requestAnimationFrame(dismissWhenBoardReady);
}

requestAnimationFrame(dismissWhenBoardReady);
