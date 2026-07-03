// camera-store — ephemeral Zustand store for Camera Mode (ADR-107): the live
// overhead-camera stream plus the 4-point manual alignment flow. Not project
// data and not undoable, so it lives outside the project store (like ui-store).
//
// I/O actions take the CameraAdapter as an argument (the same dependency-
// injection pattern as laser-store's connect(adapter)), so the store stays
// testable with a fake adapter and never imports platform/web directly.

import { create } from 'zustand';
import {
  addAlignmentPoint,
  beginAlignment,
  type AlignmentState,
  type RgbaImage,
} from '../../core/camera';
import type { Vec2 } from '../../core/scene';
import type { CameraAdapter, CameraDevice, CameraStream } from '../../platform/types';
import { loadPreferredCameraId, savePreferredCameraId } from './camera-preference-storage';

export type CameraStreamState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'live'; readonly stream: CameraStream }
  | { readonly kind: 'denied' }
  | { readonly kind: 'error'; readonly message: string };

export type NetworkCameraState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'detecting' }
  | { readonly kind: 'found'; readonly frameUrl: string }
  | { readonly kind: 'not-found' };

export type CameraStore = {
  // Camera panel visibility — floating, NON-modal like the registration jig
  // panel. Lives here (not ui-store) so all Camera Mode state is one slice.
  readonly panelOpen: boolean;
  readonly isSupported: boolean;
  readonly cameras: ReadonlyArray<CameraDevice>;
  readonly selectedDeviceId: string | null;
  readonly stream: CameraStreamState;
  readonly alignment: AlignmentState;
  // Bumped on every stop/restart so an in-flight openStream that resolves late
  // can tell it has been superseded and release its now-orphaned stream.
  readonly streamEpoch: number;
  // The machine-integrated HTTP camera (Falcon A1 Pro) found by auto-detect.
  readonly networkCamera: NetworkCameraState;

  // Workspace overlay preferences (ephemeral; the alignment itself persists
  // on the device profile). `overlayStill` is a captured frame shown instead
  // of the live video — LightBurn's "Update Overlay" model.
  readonly overlayVisible: boolean;
  readonly overlayOpacityPercent: number;
  readonly overlayStill: RgbaImage | null;

  readonly togglePanel: () => void;
  readonly closePanel: () => void;
  readonly setOverlayVisible: (on: boolean) => void;
  readonly setOverlayOpacityPercent: (percent: number) => void;
  readonly setOverlayStill: (frame: RgbaImage | null) => void;
  readonly detectSupport: (camera: CameraAdapter | undefined) => void;
  readonly detectNetworkCamera: (camera: CameraAdapter | undefined) => Promise<void>;
  readonly refreshCameras: (camera: CameraAdapter | undefined) => Promise<void>;
  readonly selectCamera: (deviceId: string) => void;
  readonly startStream: (camera: CameraAdapter | undefined) => Promise<void>;
  readonly stopStream: () => void;
  readonly beginAlignment: (targets: ReadonlyArray<Vec2>) => void;
  readonly addAlignmentPoint: (pixel: Vec2) => void;
  readonly resetAlignment: () => void;
};

const ADAPTER_MISSING = 'Camera is not available on this platform';

// Reselection policy on a device-list refresh: keep a still-valid deliberate
// selection; else restore the remembered camera (the overhead one, not the
// laptop lid one); else default to the first (drops the pre-permission blank
// id).
function nextSelectedDeviceId(
  current: string | null,
  cameras: ReadonlyArray<CameraDevice>,
): string | null {
  if (current !== null && current !== '' && cameras.some((c) => c.deviceId === current)) {
    return current;
  }
  const preferred = loadPreferredCameraId();
  if (preferred !== null && cameras.some((c) => c.deviceId === preferred)) return preferred;
  return cameras[0]?.deviceId ?? null;
}

function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    return err.message === '' ? err.name : `${err.name}: ${err.message}`;
  }
  if (err instanceof Error && err.message !== '') return err.message;
  return 'Failed to open the camera';
}

export const useCameraStore = create<CameraStore>((set, get) => ({
  panelOpen: false,
  isSupported: false,
  cameras: [],
  selectedDeviceId: null,
  stream: { kind: 'idle' },
  alignment: { kind: 'idle' },
  streamEpoch: 0,
  networkCamera: { kind: 'idle' },

  overlayVisible: true,
  overlayOpacityPercent: 50,
  overlayStill: null,

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  closePanel: () => set({ panelOpen: false }),
  setOverlayVisible: (on) => set({ overlayVisible: on }),
  setOverlayOpacityPercent: (percent) =>
    set({ overlayOpacityPercent: Math.max(0, Math.min(100, percent)) }),
  setOverlayStill: (frame) => set({ overlayStill: frame }),
  detectSupport: (camera) => set({ isSupported: camera?.isSupported() ?? false }),

  detectNetworkCamera: async (camera) => {
    if (camera === undefined) {
      set({ networkCamera: { kind: 'not-found' } });
      return;
    }
    set({ networkCamera: { kind: 'detecting' } });
    const found = await camera.discoverNetworkCamera();
    set({
      networkCamera:
        found === null ? { kind: 'not-found' } : { kind: 'found', frameUrl: found.frameUrl },
    });
  },

  refreshCameras: async (camera) => {
    if (camera === undefined) return;
    const cameras = await camera.listCameras();
    set((state) => ({
      cameras,
      selectedDeviceId: nextSelectedDeviceId(state.selectedDeviceId, cameras),
    }));
  },

  selectCamera: (deviceId) => {
    savePreferredCameraId(deviceId);
    set({ selectedDeviceId: deviceId });
  },

  startStream: async (camera) => {
    if (camera === undefined) {
      set({ stream: { kind: 'error', message: ADAPTER_MISSING } });
      return;
    }
    get().stopStream(); // stop any current stream and bump the epoch
    const epoch = get().streamEpoch;
    set({ stream: { kind: 'starting' } });
    const deviceId = get().selectedDeviceId ?? undefined;
    try {
      const opened = await camera.openStream(deviceId);
      if (get().streamEpoch !== epoch) {
        // A newer start/stop superseded us while opening — release the
        // orphaned stream so the camera doesn't stay on.
        opened?.stop();
        return;
      }
      if (opened === null) {
        set({ stream: { kind: 'denied' } });
        return;
      }
      set({ stream: { kind: 'live', stream: opened } });
      // Permission is granted now, so device labels/ids are finally readable —
      // refresh the list so the picker can show real names (the overhead USB
      // camera vs the built-in laptop one).
      void get().refreshCameras(camera);
    } catch (err) {
      if (get().streamEpoch !== epoch) return;
      set({ stream: { kind: 'error', message: cameraErrorMessage(err) } });
    }
  },

  stopStream: () => {
    const current = get().stream;
    if (current.kind === 'live') current.stream.stop();
    set((state) => ({ stream: { kind: 'idle' }, streamEpoch: state.streamEpoch + 1 }));
  },

  beginAlignment: (targets) => set({ alignment: beginAlignment(targets) }),

  addAlignmentPoint: (pixel) =>
    set((state) => ({ alignment: addAlignmentPoint(state.alignment, pixel) })),

  resetAlignment: () => set({ alignment: { kind: 'idle' } }),
}));
