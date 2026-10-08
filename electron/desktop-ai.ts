import { app, net, safeStorage } from 'electron';
import { createAiCredentialStore } from './ai/credential-store.js';
import { createAiRuntime } from './ai/runtime.js';
import { withAiRoutes } from './ai/routes.js';
import type { ProtocolHandler } from './licensing-routes.js';

export function createDesktopAi(userDataPath: string) {
  const runtime = createAiRuntime(
    createAiCredentialStore({
      userDataPath,
      platform: process.platform,
      secureStorage: safeStorage,
    }),
    (url, init) => net.fetch(url, init),
  );
  return {
    routes: (fallback: ProtocolHandler) => withAiRoutes(fallback, runtime),
    cancel: () => runtime.cancel(),
  };
}
export function withDesktopAi(fallback: ProtocolHandler, userDataPath: string): ProtocolHandler {
  const assistant = createDesktopAi(userDataPath);
  app.once('before-quit', assistant.cancel);
  return assistant.routes(fallback);
}
