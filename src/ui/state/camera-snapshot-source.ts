// Start a network camera that serves still pictures, by its address (ADR-448):
// a phone running a camera app, or any IP camera with a snapshot URL. The
// pictures come through the camera bridge's /frame.jpg proxy like the laser's
// built-in camera, so the source is a 'machine-jpeg' one. One picture is
// fetched first, so a wrong address or a stopped app says so instead of
// showing a blank preview.

import type { CameraBridgeAdapter } from '../../platform/types';
import { captureSourceFrame, type ActiveCameraSource } from '../camera/frame-source';
import { cameraQueryFingerprint } from './camera-resource-identity';
import type { CameraSourceGet, CameraSourceSet } from './camera-source-actions';

// A phone answers far faster than a laser's embedded camera server.
export const SNAPSHOT_CAMERA_POLL_INTERVAL_MS = 500;
export const SNAPSHOT_CAMERA_NO_PICTURE =
  'The camera did not send a picture. Check the address, that the camera app is running, and that the phone and this computer are on the same network.';

export function makeStartSnapshotSource(
  set: CameraSourceSet,
  get: CameraSourceGet,
  bridgeMissing: string,
): (bridge: CameraBridgeAdapter | undefined, url: string) => Promise<void> {
  return async (bridge, url) => {
    if (bridge === undefined) {
      set({ sourceState: { kind: 'error', sourceKind: 'machine-jpeg', message: bridgeMissing } });
      return;
    }
    get().stopSource();
    const epoch = get().sourceEpoch;
    set({ sourceState: { kind: 'starting', sourceKind: 'machine-jpeg' } });
    const source: Extract<ActiveCameraSource, { readonly kind: 'machine-jpeg' }> = {
      kind: 'machine-jpeg',
      frameUrl: bridge.proxiedFrameUrl(url),
      cameraUrl: url,
      pollIntervalMs: SNAPSHOT_CAMERA_POLL_INTERVAL_MS,
    };
    const [frame, queryFingerprint] = await Promise.all([
      captureSourceFrame(source),
      cameraQueryFingerprint(url),
    ]);
    if (get().sourceEpoch !== epoch) return;
    if (frame === null) {
      set({
        sourceState: {
          kind: 'error',
          sourceKind: 'machine-jpeg',
          message: SNAPSHOT_CAMERA_NO_PICTURE,
        },
      });
      return;
    }
    set({
      sourceState: {
        kind: 'live',
        source: { ...source, ...(queryFingerprint === undefined ? {} : { queryFingerprint }) },
      },
    });
  };
}
