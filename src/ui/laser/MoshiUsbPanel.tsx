// Machine details entry for a Moshiboard reached over USB (ADR-705). It mounts
// only where the platform has the USB laser link (ADR-702: Chromium browsers
// and the desktop app) for the Moshi driver, whose capabilities list
// `usbLink` (Lihuiyu lists it too and has its own panel, so the driver's kind
// picks which panel mounts), and loads the panel body lazily so none of
// the Moshi encoder, run loop or store joins the boot bundle.

import { lazy, Suspense } from 'react';
import { selectControllerDriver } from '../../core/controllers';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';

const MoshiUsbDetails = lazy(() => import('../moshi-usb/MoshiUsbDetails'));

export function MoshiUsbPanel(): JSX.Element | null {
  const platform = usePlatform();
  const controllerKind = useStore((state) => state.project.device.controllerKind);
  const usbLink = platform.usbLink;
  const driver = selectControllerDriver(controllerKind);
  if (usbLink === undefined || driver.usbLink === undefined || driver.kind !== 'moshi') return null;
  return (
    <Suspense fallback={null}>
      <MoshiUsbDetails usbLink={usbLink} />
    </Suspense>
  );
}
