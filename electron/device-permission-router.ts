// One device permission handler for the session, shared by serial and USB
// (ADR-702). Electron keeps a single handler per session, and once it is set
// it decides every device check, so the serial grants (ADR-366, ADR-552) and
// the USB laser grants each register their own decision here instead of
// replacing each other's handler. A device type nobody registered is denied.

import type { DevicePermissionHandlerHandlerDetails } from 'electron';

export type DevicePermissionDecider = (details: DevicePermissionHandlerHandlerDetails) => boolean;

export type DevicePermissionSession = {
  setDevicePermissionHandler(
    handler: ((details: DevicePermissionHandlerHandlerDetails) => boolean) | null,
  ): void;
};

export type DevicePermissionRouter = {
  /** Decides the checks for one device type; the session handler is set on
   *  the first registration, so a session with none keeps Electron's default. */
  readonly route: (
    deviceType: DevicePermissionHandlerHandlerDetails['deviceType'],
    decide: DevicePermissionDecider,
  ) => void;
};

export function createDevicePermissionRouter(ses: DevicePermissionSession): DevicePermissionRouter {
  const deciders = new Map<string, DevicePermissionDecider>();
  return {
    route: (deviceType, decide) => {
      if (deciders.size === 0)
        ses.setDevicePermissionHandler(
          (details) => deciders.get(details.deviceType)?.(details) ?? false,
        );
      deciders.set(deviceType, decide);
    },
  };
}
