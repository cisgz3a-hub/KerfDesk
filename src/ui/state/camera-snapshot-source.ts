// Start a network camera that serves still pictures, by its address (ADR-448):
// a phone running a camera app, or any IP camera with a snapshot URL. The
// pictures come through the camera bridge's /frame.jpg proxy like the laser's
// built-in camera, so the source is a 'machine-jpeg' one. One picture is
// fetched first, so a wrong address or a stopped app says so instead of
// showing a blank preview.

import type { CameraBridgeAdapter } from '../../platform/types';
import {
  captureSourceFrame,
  withCacheBuster,
  type ActiveCameraSource,
} from '../camera/frame-source';
import { cameraIdentityFingerprints } from './camera-resource-identity';
import type { CameraSourceGet, CameraSourceSet } from './camera-source-actions';

// A phone answers far faster than a laser's embedded camera server.
export const SNAPSHOT_CAMERA_POLL_INTERVAL_MS = 500;
export const SNAPSHOT_CAMERA_NO_PICTURE =
  'The camera did not send a picture. Check the address, that the camera app is running, and that the phone and this computer are on the same network.';
// A camera that asked for a login says so (ADR-692 Amendment 1).
export const SNAPSHOT_CAMERA_LOGIN_MESSAGES: Readonly<Record<string, string>> = {
  needed:
    'The camera asks for a user name and password. Add them to the address, like http://user:password@192.168.1.50:8080/shot.jpg.',
  refused:
    'The camera refused the user name or password. Check them in the address, then connect again.',
  unsupported: 'The camera asks for its login in a form KerfDesk does not send.',
};

/**
 * Why the camera sent no picture, as the bridge last heard it. The bridge
 * answers from what it noted, without asking the camera again.
 */
export async function snapshotFailureMessage(frameUrl: string): Promise<string> {
  try {
    const response = await fetch(withCacheBuster(frameUrl));
    if (response.ok) {
      await response.body?.cancel();
      return SNAPSHOT_CAMERA_NO_PICTURE;
    }
    const body: unknown = await response.json();
    const login =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['login'] : null;
    return (
      (typeof login === 'string' && SNAPSHOT_CAMERA_LOGIN_MESSAGES[login]) ||
      SNAPSHOT_CAMERA_NO_PICTURE
    );
  } catch {
    return SNAPSHOT_CAMERA_NO_PICTURE;
  }
}

export function makeStartSnapshotSource(
  set: CameraSourceSet,
  get: CameraSourceGet,
  bridgeMissing: string,
  failureMessage: (frameUrl: string) => Promise<string> = snapshotFailureMessage,
): (bridge: CameraBridgeAdapter | undefined, url: string) => Promise<void> {
  return async (bridge, url) => {
    if (bridge === undefined) {
      set({ sourceState: { kind: 'error', sourceKind: 'machine-jpeg', message: bridgeMissing } });
      return;
    }
    get().stopSource();
    const epoch = get().sourceEpoch;
    set({ sourceState: { kind: 'starting', sourceKind: 'machine-jpeg' } });
    // The address goes to the bridge once; its pictures come by an id.
    const registered = await bridge.registerFrameSource(url);
    if (get().sourceEpoch !== epoch) return;
    if (registered.kind !== 'ok') {
      set({
        sourceState: { kind: 'error', sourceKind: 'machine-jpeg', message: registered.reason },
      });
      return;
    }
    const source: Extract<ActiveCameraSource, { readonly kind: 'machine-jpeg' }> = {
      kind: 'machine-jpeg',
      frameUrl: registered.frameUrl,
      cameraUrl: url,
      pollIntervalMs: SNAPSHOT_CAMERA_POLL_INTERVAL_MS,
    };
    const [frame, fingerprints] = await Promise.all([
      captureSourceFrame(source),
      cameraIdentityFingerprints(url),
    ]);
    if (get().sourceEpoch !== epoch) return;
    if (frame === null) {
      const message = await failureMessage(registered.frameUrl);
      if (get().sourceEpoch !== epoch) return;
      set({ sourceState: { kind: 'error', sourceKind: 'machine-jpeg', message } });
      return;
    }
    set({
      sourceState: {
        kind: 'live',
        source: { ...source, ...fingerprints },
      },
    });
  };
}
