// The desktop window's remembered camera addresses in secure storage (ADR-692
// and Amendment 1): main keeps them under the operating system's encryption
// and hands one back over app://app, one route per slot. Every failure reads as
// "nothing kept", so the camera panel falls back to the public address the
// window remembers itself.

import type { CameraAddressVault } from '../../core/camera/camera-address-vault';

const ROUTE = 'app://app/api/camera-address/';
const HEADER = { 'X-KerfDesk-Camera-Address': '1' };

export function createDesktopCameraAddressVault(fetcher: typeof fetch = fetch): CameraAddressVault {
  return {
    read: async (slot) => {
      try {
        const response = await fetcher(`${ROUTE}${slot}`, {
          method: 'GET',
          headers: { ...HEADER, Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!response.ok) return null;
        const body: unknown = await response.json();
        const address =
          typeof body === 'object' && body !== null
            ? (body as Record<string, unknown>)['address']
            : null;
        return typeof address === 'string' ? address : null;
      } catch {
        return null;
      }
    },
    write: async (slot, address) => {
      try {
        const response = await fetcher(`${ROUTE}${slot}`, {
          method: 'POST',
          headers: { ...HEADER, 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
          cache: 'no-store',
        });
        if (!response.ok) return false;
        const body: unknown = await response.json();
        return (
          typeof body === 'object' && body !== null && (body as { saved?: unknown }).saved === true
        );
      } catch {
        return false;
      }
    },
  };
}
