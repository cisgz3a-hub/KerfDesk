import type { CameraStream, CameraStreamStatus } from '../../platform/types';
import type { ActiveCameraSource } from '../camera/frame-source';

export type UsbCameraSource = Extract<ActiveCameraSource, { readonly kind: 'usb' }>;

export type ManagedUsbCameraSource = {
  readonly source: UsbCameraSource;
  readonly observe: (handler: (status: CameraStreamStatus) => void) => void;
  readonly stop: () => void;
};

/** Bind optional track observation while preserving the adapter's stream identity. */
export function managedUsbCameraSource(opened: CameraStream): ManagedUsbCameraSource {
  let dispose: (() => void) | undefined;
  let stopped = false;
  return {
    source: { kind: 'usb', stream: opened },
    observe: (handler) => {
      const nextDispose = opened.onStatusChange?.(handler);
      if (stopped) nextDispose?.();
      else dispose = nextDispose;
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      dispose?.();
      dispose = undefined;
      opened.stop();
    },
  };
}
