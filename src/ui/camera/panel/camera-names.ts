// Plain names for the camera in use (ADR-663), so the panel and the setup
// wizard say "Laser's built-in camera" rather than a source kind or an address.

import type { CameraDevice } from '../../../platform/types';
import type { MachineCameraState } from '../../state/camera-store';
import type { ActiveCameraSource } from '../frame-source';

export const MACHINE_CAMERA_NAME = "Laser's built-in camera";

export type CameraNameContext = {
  readonly cameras: ReadonlyArray<CameraDevice>;
  readonly selectedDeviceId: string | null;
  readonly machineCamera: MachineCameraState;
};

export function cameraSourceName(source: ActiveCameraSource, context: CameraNameContext): string {
  switch (source.kind) {
    case 'usb':
      return usbCameraName(context.cameras, context.selectedDeviceId);
    case 'machine-jpeg':
      // The laser's camera and a phone camera app both serve still pictures;
      // only the one the bridge found on the laser is the laser's (ADR-448).
      return context.machineCamera.kind === 'found' &&
        context.machineCamera.cameraUrl === source.cameraUrl
        ? MACHINE_CAMERA_NAME
        : 'Phone camera';
    case 'machine-rtsp':
      return 'Network camera';
  }
}

/** The device's own label, or its place in the list before permission names it. */
export function usbCameraName(
  cameras: ReadonlyArray<CameraDevice>,
  deviceId: string | null,
): string {
  const index = cameras.findIndex((camera) => camera.deviceId === deviceId);
  const label = cameras[index]?.label;
  if (label !== undefined && label !== '') return label;
  return index >= 0 && cameras.length > 1 ? `USB camera ${index + 1}` : 'USB camera';
}
