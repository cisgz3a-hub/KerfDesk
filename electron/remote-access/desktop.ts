import { safeStorage } from 'electron';
import { createRemoteCredentialStore } from './credential-store.js';
import { createRemoteRendererQueue } from './renderer-queue.js';
import { createRemoteAccessRuntime } from './runtime.js';
import { withRemoteAccessRoutes } from './routes.js';
import type { ProtocolHandler } from '../licensing-routes.js';

type WindowLifecycle = {
  on(event: 'closed', listener: () => void): unknown;
  webContents: {
    on(event: 'did-start-loading' | 'render-process-gone', listener: () => void): unknown;
  };
};

/** Construction performs no storage or network work; trusted attach starts it after opening. */
export function createDesktopRemoteAccess(
  userDataPath: string,
  secureStorage: Parameters<typeof createRemoteCredentialStore>[0]['secureStorage'] = safeStorage,
) {
  const queue = createRemoteRendererQueue();
  const runtime = createRemoteAccessRuntime(
    createRemoteCredentialStore({ userDataPath, platform: process.platform, secureStorage }),
    queue,
  );
  const close = (): void => {
    queue.detach();
    runtime.closed();
  };
  return {
    close,
    routes: (fallback: ProtocolHandler) => withRemoteAccessRoutes(fallback, runtime, queue),
    observe(window: WindowLifecycle): void {
      window.webContents.on('did-start-loading', close);
      window.webContents.on('render-process-gone', close);
      window.on('closed', close);
    },
    cleanup: (next: () => Promise<void> | undefined) => () => {
      close();
      return next();
    },
  };
}
