// camera-store — ephemeral Zustand store for Camera Mode (ADR-107/116): the
// active camera source (USB stream or bridge-proxied machine camera) plus the
// 4-point manual alignment flow. Not project data and not undoable, so it
// lives outside the project store (like ui-store).
//
// I/O actions take the platform adapters as arguments (the same dependency-
// injection pattern as laser-store's connect(adapter)), so the store stays
// testable with fakes and never imports platform/web directly.

import { create } from 'zustand';
import {
  addAlignmentPoint,
  beginAlignment,
  type AlignmentState,
  type RgbaImage,
} from '../../core/camera';
import type { CameraCaptureBinding } from '../../core/camera/camera-capture-binding';
import type { Vec2 } from '../../core/scene';
import type { CameraAdapter, CameraDevice } from '../../platform/types';
import {
  createCameraSourceActions,
  type CameraSourceActions,
  type CameraSourceState,
  type MachineCameraState,
} from './camera-source-actions';
import { loadPreferredCameraId, savePreferredCameraId } from './camera-preference-storage';

export type { CameraSourceState, MachineCameraState } from './camera-source-actions';

export type CameraStore = CameraSourceActions & {
  // Camera panel visibility — floating, NON-modal like the registration jig
  // panel. Lives here (not ui-store) so all Camera Mode state is one slice.
  readonly panelOpen: boolean;
  readonly isSupported: boolean;
  readonly cameras: ReadonlyArray<CameraDevice>;
  readonly selectedDeviceId: string | null;
  // The active source every camera consumer captures through (ADR-116).
  readonly sourceState: CameraSourceState;
  readonly alignment: AlignmentState;
  // Bumped on every stop/restart so an in-flight start that resolves late can
  // tell it has been superseded and release its now-orphaned stream.
  readonly sourceEpoch: number;
  // The machine-integrated camera found by the bridge's server-side probe.
  readonly machineCamera: MachineCameraState;

  // Workspace overlay preferences (ephemeral; the alignment itself persists
  // on the device profile). `overlayStill` is a captured frame shown instead
  // of the live video — LightBurn's "Update Overlay" model.
  readonly overlayVisible: boolean;
  readonly overlayOpacityPercent: number;
  readonly overlayStill: RgbaImage | null;
  readonly overlayStillCapture: CameraCaptureBinding | null;
  // Top surface currently being viewed/placed on, measured above machine bed.
  // Kept separate from the alignment plane so perspective can be compensated.
  readonly surfaceHeightMm: number;
  // Latches once the aligned overlay is used for physical placement. Hiding
  // the image does not silently discard the safety contract; the operator
  // exits placement mode explicitly after finishing camera-based layout.
  readonly placementActive: boolean;
  // No-homing machines need an explicit controller-to-bed confirmation. It is
  // tied to LaserState.trustedPositionEpoch so reconnect/reset/alarm invalidates
  // it without a cross-store subscription.
  readonly confirmedPositionEpoch: number | null;

  readonly togglePanel: () => void;
  readonly closePanel: () => void;
  readonly setOverlayVisible: (on: boolean) => void;
  readonly setOverlayOpacityPercent: (percent: number) => void;
  readonly setOverlayStill: (
    frame: RgbaImage | null,
    capture?: CameraCaptureBinding | null,
  ) => void;
  readonly setSurfaceHeightMm: (heightMm: number) => void;
  readonly activatePlacement: () => void;
  readonly deactivatePlacement: () => void;
  readonly confirmPositionEpoch: (epoch: number) => void;
  readonly detectSupport: (camera: CameraAdapter | undefined) => void;
  readonly refreshCameras: (camera: CameraAdapter | undefined) => Promise<void>;
  readonly selectCamera: (deviceId: string) => void;
  readonly beginAlignment: (targets: ReadonlyArray<Vec2>) => void;
  readonly addAlignmentPoint: (pixel: Vec2) => void;
  readonly resetAlignment: () => void;
};

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

export const useCameraStore = create<CameraStore>((set, get) => ({
  ...createCameraSourceActions(set, get),

  panelOpen: false,
  isSupported: false,
  cameras: [],
  selectedDeviceId: null,
  sourceState: { kind: 'idle' },
  alignment: { kind: 'idle' },
  sourceEpoch: 0,
  machineCamera: { kind: 'idle' },

  overlayVisible: true,
  overlayOpacityPercent: 50,
  overlayStill: null,
  overlayStillCapture: null,
  surfaceHeightMm: 0,
  placementActive: false,
  confirmedPositionEpoch: null,

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  closePanel: () => set({ panelOpen: false }),
  setOverlayVisible: (on) => set({ overlayVisible: on }),
  setOverlayOpacityPercent: (percent) =>
    set({ overlayOpacityPercent: Math.max(0, Math.min(100, percent)) }),
  setOverlayStill: (frame, capture = null) =>
    set({ overlayStill: frame, overlayStillCapture: frame === null ? null : capture }),
  setSurfaceHeightMm: (heightMm) => set({ surfaceHeightMm: clampFinite(heightMm, 0, 500) }),
  activatePlacement: () => set({ placementActive: true }),
  deactivatePlacement: () =>
    set({ placementActive: false, overlayVisible: false, confirmedPositionEpoch: null }),
  confirmPositionEpoch: (epoch) => set({ confirmedPositionEpoch: epoch }),
  detectSupport: (camera) => set({ isSupported: camera?.isSupported() ?? false }),

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

  beginAlignment: (targets) => set({ alignment: beginAlignment(targets) }),

  addAlignmentPoint: (pixel) =>
    set((state) => ({ alignment: addAlignmentPoint(state.alignment, pixel) })),

  resetAlignment: () => set({ alignment: { kind: 'idle' } }),
}));

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
