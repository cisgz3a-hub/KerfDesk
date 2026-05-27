// Web entry point. Mounts the React tree into #app-root.
// Electron renderer reuses this entry once the desktop shell lands —
// the only difference is the adapter passed to PlatformProvider.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { webAdapter } from '../../platform/web';
import { App } from './App';
import { PlatformProvider } from './platform-context';

const rootElement = document.getElementById('app-root');
if (rootElement === null) {
  throw new Error('Root element #app-root not found in index.html.');
}

createRoot(rootElement).render(
  <StrictMode>
    <PlatformProvider adapter={webAdapter}>
      <App />
    </PlatformProvider>
  </StrictMode>,
);
