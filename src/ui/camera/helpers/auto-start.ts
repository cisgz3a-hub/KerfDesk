// Start the camera the operator used last (ADR-663 Amendment 1), so it is
// running without hunting for it: the laser's own camera through the bridge,
// the USB camera that ran last when it is plugged in, or the remembered RTSP or
// phone address. It acts only on a camera that is not running, starting or
// showing a problem, tries once per call, and stays quiet when the camera is not
// there: a problem shows in the Camera panel as for a camera started by hand.

import type { CameraAdapter, CameraBridgeAdapter } from '../../../platform/types';
import {
  loadLastCameraSource,
  loadPhoneCamera,
  loadPreferredCameraId,
  loadRtspCameraUrl,
  type LastCameraSource,
} from '../../state/camera-preference-storage';
import { useCameraStore, type MachineCameraState } from '../../state/camera-store';
import type { ActiveCameraSource } from '../frame-source';
import { phoneSnapshotUrl } from '../phone-camera-address';
import { useCameraHelpersStore } from './camera-helpers-store';

export type CameraStartDeps = {
  readonly camera: CameraAdapter | undefined;
  readonly bridge: CameraBridgeAdapter | undefined;
  /** The local camera bridge answers here (Desktop, or local development). */
  readonly bridgeAvailable: boolean;
};

// Machine discovery that is already running is waited for, up to this long.
export const DETECTION_WAIT_MS = 15_000;

/** The kind of camera `source` is, as the next start looks for it. */
export function lastSourceKind(
  source: ActiveCameraSource,
  machineCamera: MachineCameraState,
): LastCameraSource {
  switch (source.kind) {
    case 'usb':
      return 'usb';
    case 'machine-rtsp':
      return 'rtsp';
    case 'machine-jpeg':
      return machineCamera.kind === 'found' && machineCamera.cameraUrl === source.cameraUrl
        ? 'machine'
        : 'phone';
  }
}

/** Start the remembered camera when the helper is on and no camera is running. */
export async function startRememberedCamera(deps: CameraStartDeps): Promise<void> {
  if (!useCameraHelpersStore.getState().settings.autoStart) return;
  const last = loadLastCameraSource();
  if (last === null || !cameraIdle()) return;
  switch (last) {
    case 'machine':
      return startMachineCamera(deps);
    case 'usb':
      return startUsbCamera(deps.camera);
    case 'rtsp':
    case 'phone':
      return startAddressCamera(last, deps);
  }
}

// A network camera from its remembered, login-free address (ADR-116, ADR-448).
async function startAddressCamera(kind: 'rtsp' | 'phone', deps: CameraStartDeps): Promise<void> {
  if (!deps.bridgeAvailable) return;
  if (kind === 'rtsp') {
    const url = loadRtspCameraUrl();
    if (url !== null) await useCameraStore.getState().startRtspSource(deps.bridge, url);
    return;
  }
  const phone = loadPhoneCamera();
  const url = phone === null ? null : phoneSnapshotUrl(phone.app, phone.address);
  if (url !== null) await useCameraStore.getState().startSnapshotSource(deps.bridge, url);
}

function cameraIdle(): boolean {
  return useCameraStore.getState().sourceState.kind === 'idle';
}

// The laser's camera answers once the laser is connected, so a camera not
// found earlier is looked for again.
async function startMachineCamera(deps: CameraStartDeps): Promise<void> {
  if (!deps.bridgeAvailable) return;
  const { machineCamera, detectMachineCamera } = useCameraStore.getState();
  if (machineCamera.kind === 'detecting') await detectionSettled();
  else if (machineCamera.kind !== 'found') await detectMachineCamera(deps.bridge);
  const now = useCameraStore.getState();
  if (now.machineCamera.kind === 'found' && cameraIdle()) now.activateMachineCamera();
}

function detectionSettled(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, DETECTION_WAIT_MS);
    const stop = useCameraStore.subscribe((state) => {
      if (state.machineCamera.kind !== 'detecting') done();
    });
    function done(): void {
      clearTimeout(timer);
      stop();
      resolve();
    }
  });
}

// Only the USB camera that ran last: another one plugged in (a laptop's own
// camera, say) is never started in its place.
async function startUsbCamera(camera: CameraAdapter | undefined): Promise<void> {
  const preferred = loadPreferredCameraId();
  if (camera === undefined || !camera.isSupported() || preferred === null) return;
  const store = useCameraStore.getState();
  await store.refreshCameras(camera);
  const { cameras } = useCameraStore.getState();
  if (!cameras.some((device) => device.deviceId === preferred) || !cameraIdle()) return;
  useCameraStore.getState().selectCamera(preferred);
  await useCameraStore.getState().startUsbSource(camera);
}
