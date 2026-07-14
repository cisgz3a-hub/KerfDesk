// Camera source lifecycle actions (ADR-116), extracted from camera-store so
// the store file stays within size limits. Covers machine-camera discovery
// through the bridge and starting/stopping the active source (USB stream or
// bridge-proxied machine camera).

import type { CameraAdapter, CameraBridgeAdapter } from '../../platform/types';
import { publicCameraSourceId, type ActiveCameraSource } from '../camera/frame-source';

export type CameraSourceState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'live'; readonly source: ActiveCameraSource }
  // getUserMedia permission denied (USB path only).
  | { readonly kind: 'denied' }
  | { readonly kind: 'error'; readonly message: string };

export type MachineCameraState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'detecting' }
  | { readonly kind: 'found'; readonly cameraUrl: string; readonly proxyFrameUrl: string }
  | { readonly kind: 'not-found' }
  // The bridge is missing/unreachable; `reason` says how to start it.
  | { readonly kind: 'unavailable'; readonly reason: string };

export type CameraSourceActions = {
  readonly detectMachineCamera: (bridge: CameraBridgeAdapter | undefined) => Promise<void>;
  readonly activateMachineCamera: () => void;
  readonly startUsbSource: (camera: CameraAdapter | undefined) => Promise<void>;
  readonly startRtspSource: (bridge: CameraBridgeAdapter | undefined, url: string) => Promise<void>;
  readonly stopSource: () => void;
};

// The slice of camera-store these actions read and write. Structural, so the
// store file can import this module without a type cycle.
type CameraSourceSlice = CameraSourceActions & {
  readonly sourceState: CameraSourceState;
  readonly sourceEpoch: number;
  readonly machineCamera: MachineCameraState;
  readonly selectedDeviceId: string | null;
  readonly refreshCameras: (camera: CameraAdapter | undefined) => Promise<void>;
};

type Set = (
  partial: Partial<CameraSourceSlice> | ((state: CameraSourceSlice) => Partial<CameraSourceSlice>),
) => void;
type Get = () => CameraSourceSlice;

const ADAPTER_MISSING = 'Camera is not available on this platform';
const BRIDGE_MISSING =
  'The local camera bridge is not running — LaserForge Desktop starts it automatically; in a browser run pnpm camera:bridge.';
const FFMPEG_MISSING =
  'FFmpeg is not installed on this computer — RTSP cameras need it for preview and capture. Install it, then reconnect.';
const NO_PREVIEW_URL = 'The camera bridge did not return a preview URL for this RTSP camera.';

function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    return err.message === '' ? err.name : `${err.name}: ${err.message}`;
  }
  if (err instanceof Error && err.message !== '') return err.message;
  return 'Failed to open the camera';
}

export function createCameraSourceActions(set: Set, get: Get): CameraSourceActions {
  return {
    detectMachineCamera: makeDetectMachineCamera(set),
    activateMachineCamera: makeActivateMachineCamera(set, get),
    startUsbSource: makeStartUsbSource(set, get),
    startRtspSource: makeStartRtspSource(set, get),
    stopSource: makeStopSource(set, get),
  };
}

// Machine cameras are probed by the bridge server-side (ADR-116): the
// browser-side <img> probe is CSP-blocked in the desktop app and on the
// deployed site, so the bridge is the one discovery path.
function makeDetectMachineCamera(set: Set): CameraSourceActions['detectMachineCamera'] {
  return async (bridge) => {
    if (bridge === undefined) {
      set({ machineCamera: { kind: 'unavailable', reason: BRIDGE_MISSING } });
      return;
    }
    set({ machineCamera: { kind: 'detecting' } });
    const result = await bridge.discoverMachineCamera();
    if (result.kind === 'found') {
      set({
        machineCamera: {
          kind: 'found',
          cameraUrl: result.cameraUrl,
          proxyFrameUrl: result.proxyFrameUrl,
        },
      });
      return;
    }
    set({
      machineCamera:
        result.kind === 'not-found'
          ? { kind: 'not-found' }
          : { kind: 'unavailable', reason: result.reason },
    });
  };
}

// Make the discovered machine camera the active source. Every consumer
// (calibration wizard, auto-align, still overlay, trace) captures through
// it exactly like a USB stream — this is what un-disables "Calibrate
// lens…" for machine cameras.
function makeActivateMachineCamera(
  set: Set,
  get: Get,
): CameraSourceActions['activateMachineCamera'] {
  return () => {
    const machine = get().machineCamera;
    if (machine.kind !== 'found') return;
    get().stopSource();
    set({
      sourceState: {
        kind: 'live',
        source: {
          kind: 'machine-jpeg',
          frameUrl: machine.proxyFrameUrl,
          cameraUrl: machine.cameraUrl,
        },
      },
    });
  };
}

function makeStartUsbSource(set: Set, get: Get): CameraSourceActions['startUsbSource'] {
  return async (camera) => {
    if (camera === undefined) {
      set({ sourceState: { kind: 'error', message: ADAPTER_MISSING } });
      return;
    }
    get().stopSource(); // stop any current source and bump the epoch
    const epoch = get().sourceEpoch;
    set({ sourceState: { kind: 'starting' } });
    const deviceId = get().selectedDeviceId ?? undefined;
    try {
      const opened = await camera.openStream(deviceId);
      if (get().sourceEpoch !== epoch) {
        // A newer start/stop superseded us while opening — release the
        // orphaned stream so the camera doesn't stay on.
        opened?.stop();
        return;
      }
      if (opened === null) {
        set({ sourceState: { kind: 'denied' } });
        return;
      }
      set({ sourceState: { kind: 'live', source: { kind: 'usb', stream: opened } } });
      // Permission is granted now, so device labels/ids are finally
      // readable — refresh the list so the picker can show real names.
      void get().refreshCameras(camera);
    } catch (err) {
      if (get().sourceEpoch !== epoch) return;
      set({ sourceState: { kind: 'error', message: cameraErrorMessage(err) } });
    }
  };
}

// Connect an operator-entered RTSP camera: probe it through the bridge,
// then go live on the bridge's MJPEG preview + single-frame capture URLs.
function makeStartRtspSource(set: Set, get: Get): CameraSourceActions['startRtspSource'] {
  return async (bridge, url) => {
    if (bridge === undefined) {
      set({ sourceState: { kind: 'error', message: BRIDGE_MISSING } });
      return;
    }
    get().stopSource();
    const epoch = get().sourceEpoch;
    set({ sourceState: { kind: 'starting' } });
    const probe = await bridge.probeRtspCamera({ url });
    if (get().sourceEpoch !== epoch) return;
    if (probe.kind !== 'ok') {
      set({ sourceState: { kind: 'error', message: probe.reason } });
      return;
    }
    if (!probe.ffmpegAvailable) {
      set({ sourceState: { kind: 'error', message: FFMPEG_MISSING } });
      return;
    }
    if (probe.previewUrl === undefined) {
      set({ sourceState: { kind: 'error', message: NO_PREVIEW_URL } });
      return;
    }
    set({
      sourceState: {
        kind: 'live',
        source: {
          kind: 'machine-rtsp',
          previewUrl: probe.previewUrl,
          frameUrl: bridge.proxiedFrameUrl(url),
          sourceId: publicCameraSourceId(url),
        },
      },
    });
  };
}

function makeStopSource(set: Set, get: Get): CameraSourceActions['stopSource'] {
  return () => {
    const current = get().sourceState;
    if (current.kind === 'live' && current.source.kind === 'usb') {
      current.source.stream.stop();
    }
    set((state) => ({ sourceState: { kind: 'idle' }, sourceEpoch: state.sourceEpoch + 1 }));
  };
}
