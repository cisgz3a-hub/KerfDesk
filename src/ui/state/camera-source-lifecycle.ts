import { assertNever } from '../../core/scene';
import type { CameraAdapter, CameraStreamStatus } from '../../platform/types';
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
