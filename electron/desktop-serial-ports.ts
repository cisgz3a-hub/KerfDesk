// Serial access for the desktop session. Every platform gets the Select dialog
// (desktop-serial-chooser.ts), and only the picked port is granted (ADR-366).
// On Windows, macOS and Linux main also remembers the picks across restarts
// (ADR-552, ADR-607), as Chrome does: a device permission handler grants the
// trusted page exactly the ports picked there and not forgotten, and nothing
// else. Electron keeps a pick it cannot remember (on macOS and Linux, an
// adapter with no serial number) for the run, and any other system has no
// handler at all.

import { join } from 'node:path';
import type {
  DevicePermissionHandlerHandlerDetails,
  Event as ElectronEvent,
  SerialPort,
  SerialPortRevokedDetails,
  WebContents,
} from 'electron';
import type { DevicePermissionRouter } from './device-permission-router.js';
import { handleSelectSerialPort } from './desktop-serial-chooser.js';
import {
  readSerialPortGrants,
  SERIAL_PORT_GRANTS_FILE,
  SerialPortGrants,
  serialPortGrantsWriter,
  serialPortIdentity,
  type SerialPortIdentity,
} from './serial-port-grants.js';
import { isTrustedRendererOrigin } from './trusted-renderer-policy.js';

type SelectSerialPortListener = (
  event: ElectronEvent,
  portList: SerialPort[],
  webContents: WebContents,
  callback: (portId: string) => void,
) => void;

/** The part of an Electron Session this wiring uses. */
export type SerialSession = {
  on(event: 'select-serial-port', listener: SelectSerialPortListener): unknown;
  on(
    event: 'serial-port-revoked',
    listener: (event: ElectronEvent, details: SerialPortRevokedDetails) => void,
  ): unknown;
  setDevicePermissionHandler(
    handler: ((details: DevicePermissionHandlerHandlerDetails) => boolean) | null,
  ): void;
};

export type DesktopSerialPortOptions = {
  readonly trustedOrigins: ReadonlySet<string>;
  readonly userDataPath: string;
  readonly platform?: NodeJS.Platform;
  readonly devicePermissions?: DevicePermissionRouter;
};

export function installDesktopSerialPorts(
  ses: SerialSession,
  options: DesktopSerialPortOptions,
): void {
  const identity = serialPortIdentity(options.platform ?? process.platform);
  const memory = identity === null ? undefined : rememberPicks(ses, options, identity);
  ses.on('select-serial-port', (event, portList, webContents, callback) => {
    handleSelectSerialPort(event, portList, webContents, callback, memory);
  });
}

function rememberPicks(
  ses: SerialSession,
  options: DesktopSerialPortOptions,
  identity: SerialPortIdentity,
): SerialPortGrants {
  const file = join(options.userDataPath, SERIAL_PORT_GRANTS_FILE);
  const grants = new SerialPortGrants(
    readSerialPortGrants(file),
    serialPortGrantsWriter(file),
    identity,
  );
  const decide = (details: DevicePermissionHandlerHandlerDetails): boolean =>
    details.deviceType === 'serial' &&
    isTrustedRendererOrigin(details.origin, options.trustedOrigins) &&
    grants.allows(details.device);
  // Shared with the USB lasers (ADR-702): the session has one handler.
  if (options.devicePermissions === undefined) ses.setDevicePermissionHandler(decide);
  else options.devicePermissions.route('serial', decide);
  ses.on('serial-port-revoked', (_event, details) => grants.revoke(details.port));
  return grants;
}
