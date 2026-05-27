// Web entry point. Mounts the React tree into #app-root.
// Electron renderer reuses this entry once the desktop shell lands —
// the only difference is the adapter passed to PlatformProvider.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { webAdapter } from '../../platform/web';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { App } from './App';
import { PlatformProvider } from './platform-context';

const rootElement = document.getElementById('app-root');
if (rootElement === null) {
  throw new Error('Root element #app-root not found in index.html.');
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <PlatformProvider adapter={webAdapter}>
        <App />
      </PlatformProvider>
    </ErrorBoundary>
  </StrictMode>,
);
