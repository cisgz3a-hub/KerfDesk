import { createCameraBridgeKeys } from './camera-bridge-keys.js';
import { cameraBridgeLifecycle } from './camera-bridge-lifecycle.js';
import { withCameraBridgeRoutes } from './camera-bridge-routes.js';
import type { ProtocolHandler } from './licensing-routes.js';
import { CAMERA_BRIDGE_PORT, startLocalRtspCameraBridge } from './rtsp-camera-bridge.js';

/**
 * The desktop app's camera bridge. It runs only while a workspace is admitted
 * past the licence window (ADR-623). With `keyed`, it is started with this
 * launch's keys, and `routes` adds the app://app route that gives the window
 * those keys or the reason the bridge is not running (ADR-141 Amendment 2).
 * A dev-server window cannot reach app routes, so it keeps the keyless
 * development bridge.
 */
export function createDesktopCameraBridge(options: { readonly keyed: boolean }) {
  const keys = options.keyed ? createCameraBridgeKeys() : undefined;
  const lifecycle = cameraBridgeLifecycle(() =>
    startLocalRtspCameraBridge(CAMERA_BRIDGE_PORT, keys),
  );
  return {
    setRunning: lifecycle.setRunning,
    close: lifecycle.close,
    routes: (fallback: ProtocolHandler): ProtocolHandler =>
      keys === undefined
        ? fallback
        : withCameraBridgeRoutes(fallback, {
            origin: `http://127.0.0.1:${CAMERA_BRIDGE_PORT}`,
            keys,
            // The window asks before each camera connect, which also retries a
            // bridge whose port was taken when it started.
            status: async () => {
              await lifecycle.retry();
              return lifecycle.status();
            },
          }),
  };
}
