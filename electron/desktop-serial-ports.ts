// Serial access for the desktop session. Every platform gets the Select dialog
// (desktop-serial-chooser.ts), and only the picked port is granted (ADR-366).
// On Windows main also remembers the picks across restarts (ADR-552), as
// Chrome does: a device permission handler grants the trusted page exactly the
// ports picked there and not forgotten, and nothing else. Elsewhere there is
// no handler, so Electron keeps each pick for the run.

import { join } from 'node:path';
import type {
  DevicePermissionHandlerHandlerDetails,
  Event as ElectronEvent,
  SerialPort,
  SerialPortRevokedDetails,
  WebContents,
} from 'electron';
import { handleSelectSerialPort } from './desktop-serial-chooser.js';
import {
  readSerialPortGrants,
  SERIAL_PORT_GRANTS_FILE,
  SerialPortGrants,
  serialPortGrantsWriter,
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
};

export function installDesktopSerialPorts(
  ses: SerialSession,
  options: DesktopSerialPortOptions,
): void {
  const memory =
    (options.platform ?? process.platform) === 'win32' ? rememberPicks(ses, options) : undefined;
  ses.on('select-serial-port', (event, portList, webContents, callback) => {
    handleSelectSerialPort(event, portList, webContents, callback, memory);
  });
}

function rememberPicks(ses: SerialSession, options: DesktopSerialPortOptions): SerialPortGrants {
  const file = join(options.userDataPath, SERIAL_PORT_GRANTS_FILE);
  const grants = new SerialPortGrants(readSerialPortGrants(file), serialPortGrantsWriter(file));
  ses.setDevicePermissionHandler(
    (details) =>
      details.deviceType === 'serial' &&
      isTrustedRendererOrigin(details.origin, options.trustedOrigins) &&
      grants.allows(details.device),
  );
  ses.on('serial-port-revoked', (_event, details) => grants.revoke(details.port));
  return grants;
}
