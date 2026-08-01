import { assertNever } from '../../core/scene';
import type {
  CameraAdapter,
  CameraBridgeAdapter,
  CameraBridgeStreamStatus,
  CameraStreamStatus,
} from '../../platform/types';
import type { ActiveCameraSource } from '../camera/frame-source';
import type {
  CameraSourceActions,
  CameraSourceGet,
  CameraSourceSet,
  CameraSourceState,
} from './camera-source-actions';
import type { UsbCameraSource } from './camera-usb-source';

const USB_SOURCE_ENDED = 'USB camera stopped. Reconnect it if needed, then press Start USB camera.';
const RTSP_SOURCE_ENDED =
  'RTSP preview stopped. Check the camera and bridge, then press Reconnect.';
const MACHINE_JPEG_SOURCE_ENDED =
  'Machine camera preview stopped. Check the camera and bridge, then reconnect it.';
export const RTSP_STATUS_POLL_INTERVAL_MS = 1_000;

export function handleUsbStatus(
  set: CameraSourceSet,
  get: CameraSourceGet,
  camera: CameraAdapter,
  source: UsbCameraSource,
  epoch: number,
  status: CameraStreamStatus,
): void {
  if (get().sourceEpoch !== epoch || !isCurrentSource(get().sourceState, source)) return;
  switch (status) {
    case 'live':
      set({ usbAvailability: { kind: 'available' } });
      return;
    case 'muted':
      set({ usbAvailability: { kind: 'muted' } });
      return;
    case 'ended':
      get().reportSourceFailure(source);
      void get().refreshCameras(camera);
      return;
    default:
      return assertNever(status, 'camera stream status');
  }
}

export function makeReportSourceFailure(
  set: CameraSourceSet,
  get: CameraSourceGet,
): CameraSourceActions['reportSourceFailure'] {
  return (source) => {
    if (!isCurrentSource(get().sourceState, source)) return;
    if (source.kind === 'usb') releaseUsbSource(get, source);
    set((state) => ({
      sourceState: {
        kind: 'error',
        sourceKind: source.kind,
        message: sourceFailureMessage(source.kind),
      },
      sourceEpoch: state.sourceEpoch + 1,
      usbAvailability: { kind: 'available' },
      usbSourceRelease: null,
    }));
  };
}

export function makeStopSource(
  set: CameraSourceSet,
  get: CameraSourceGet,
): CameraSourceActions['stopSource'] {
  return () => {
    const current = get().sourceState;
    if (current.kind === 'live' && current.source.kind === 'usb') {
      releaseUsbSource(get, current.source);
    }
    set((state) => ({
      sourceState: { kind: 'idle' },
      sourceEpoch: state.sourceEpoch + 1,
      usbAvailability: { kind: 'available' },
      usbSourceRelease: null,
    }));
  };
}

export async function monitorRtspSource(
  get: CameraSourceGet,
  bridge: CameraBridgeAdapter,
  source: Extract<ActiveCameraSource, { readonly kind: 'machine-rtsp' }>,
  streamSessionId: string,
  epoch: number,
): Promise<void> {
  while (isCurrentSourceAtEpoch(get, source, epoch)) {
    const status = await readRtspStatus(bridge, streamSessionId);
    if (!isCurrentSourceAtEpoch(get, source, epoch)) return;
    if (status.kind === 'failed' || status.kind === 'unavailable') {
      get().reportSourceFailure(source);
      return;
    }
    await waitForNextRtspStatus();
  }
}

async function readRtspStatus(
  bridge: CameraBridgeAdapter,
  streamSessionId: string,
): Promise<CameraBridgeStreamStatus> {
  try {
    return await bridge.rtspStreamStatus(streamSessionId);
  } catch {
    return { kind: 'unavailable', reason: 'The local camera bridge status request failed.' };
  }
}

function waitForNextRtspStatus(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RTSP_STATUS_POLL_INTERVAL_MS));
}

function isCurrentSourceAtEpoch(
  get: CameraSourceGet,
  source: ActiveCameraSource,
  epoch: number,
): boolean {
  const state = get();
  return state.sourceEpoch === epoch && isCurrentSource(state.sourceState, source);
}

function releaseUsbSource(get: CameraSourceGet, source: UsbCameraSource): void {
  const release = get().usbSourceRelease;
  if (release === null) source.stream.stop();
  else release();
}

function isCurrentSource(state: CameraSourceState, source: ActiveCameraSource): boolean {
  return state.kind === 'live' && state.source === source;
}

function sourceFailureMessage(kind: ActiveCameraSource['kind']): string {
  switch (kind) {
    case 'usb':
      return USB_SOURCE_ENDED;
    case 'machine-rtsp':
      return RTSP_SOURCE_ENDED;
    case 'machine-jpeg':
      return MACHINE_JPEG_SOURCE_ENDED;
    default:
      return assertNever(kind, 'camera source kind');
  }
}
