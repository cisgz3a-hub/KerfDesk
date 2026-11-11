// Machine details entry for a K40's Lihuiyu board over USB (ADR-703). It
// mounts only where the platform has a USB link (Chromium browsers and the
// desktop app, ADR-702) and the profile's driver lists the Lihuiyu link (a
// capability check, no `kind` check, ADR-094); the panel body loads lazily so
// none of the link's code joins the boot bundle. .egv export is unchanged.

import { lazy, Suspense, useMemo } from 'react';
import { selectControllerDriver } from '../../core/controllers';
import { LIHUIYU_USB_CAPABILITIES } from '../../core/controllers/lihuiyu/driver';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';

const LihuiyuUsbDetails = lazy(() => import('../lihuiyu-usb/LihuiyuUsbDetails'));

export function LihuiyuUsbPanel(): JSX.Element | null {
  const usbLink = usePlatform().usbLink;
  const controllerKind = useStore((state) => state.project.device.controllerKind);
  const open = useMemo(
    () =>
      usbLink === undefined
        ? null
        : async () =>
            (await import('../state/lihuiyu-usb/lihuiyu-usb-opener')).lihuiyuUsbOpener(usbLink)(),
    [usbLink],
  );
  if (open === null || selectControllerDriver(controllerKind).usbLink !== LIHUIYU_USB_CAPABILITIES)
    return null;
  return (
    <Suspense fallback={null}>
      <LihuiyuUsbDetails open={open} />
    </Suspense>
  );
}
