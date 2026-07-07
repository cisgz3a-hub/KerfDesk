// Web + Electron entry point. Mounts the React tree into #app-root.
// The same web adapter serves both targets — Electron's Chromium renderer has
// the same Web Serial / File System Access / getUserMedia APIs (granted in
// electron/main.ts). We only stamp `id: 'electron'` for UI feature-gating.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isElectronRenderer } from '../../platform/electron';
import type { PlatformAdapter } from '../../platform/types';
import { webAdapter } from '../../platform/web';
import { ErrorBoundary } from '../common/ErrorBoundary';
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

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <PlatformProvider adapter={adapter}>
        <App />
      </PlatformProvider>
    </ErrorBoundary>
  </StrictMode>,
);
