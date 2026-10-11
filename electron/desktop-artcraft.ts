import { createArtcraftRuntime } from './artcraft-runtime.js';
import { withArtcraftRoutes } from './artcraft-routes.js';
import type { ProtocolHandler } from './licensing-routes.js';

/** Opt-in prototype. Editors are unmodified local apps, never remote web content. */
export function withDesktopArtcraft(
  fallback: ProtocolHandler,
  userDataPath: string,
): ProtocolHandler {
  return withArtcraftRoutes(
    fallback,
    createArtcraftRuntime(userDataPath, process.env['KERFDESK_ARTCRAFT_ROOT']),
  );
}
