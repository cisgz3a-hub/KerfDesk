// Machine details entry for a JCZ galvo reached over USB (ADR-704). It mounts
// only when the platform has a USB link (ADR-702) and the driver's galvoUsb
// capabilities list the link (no `kind` check, ADR-094), and loads the panel
// body lazily so none of the link's code joins the boot bundle.

import { lazy, Suspense } from 'react';
import { selectControllerDriver } from '../../core/controllers';
import type { PlatformAdapter } from '../../platform/types';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';
import type { GalvoUsbAdapter } from '../state/galvo-usb/galvo-usb-types';

const GalvoUsbDetails = lazy(() => import('../jcz-usb/GalvoUsbDetails'));

/** The platform's USB link (ADR-702), typed as the galvo store uses it. */
export function galvoUsbAdapterOf(platform: PlatformAdapter): GalvoUsbAdapter | undefined {
  return (platform as PlatformAdapter & { readonly usbLink?: GalvoUsbAdapter }).usbLink;
}

export function GalvoUsbPanel(): JSX.Element | null {
  const platform = usePlatform();
  const controllerKind = useStore((state) => state.project.device.controllerKind);
  const adapter = galvoUsbAdapterOf(platform);
  if (adapter === undefined || selectControllerDriver(controllerKind).galvoUsb === undefined)
    return null;
  return (
    <Suspense fallback={null}>
      <GalvoUsbDetails adapter={adapter} />
    </Suspense>
  );
}
