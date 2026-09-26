// Which USB port the machine was on last time, and whether KerfDesk connects
// to it by itself (ADR-420). Browser-local app state, never part of a project:
// a port grant belongs to this browser or desktop install, not to a file.
// Storage is injected so the logic is testable; reads and writes fail soft.

import type { SerialPortIdentity, SerialPortRef } from '../../platform/types';

export const SERIAL_PORT_MEMORY_STORAGE_KEY = 'kerfdesk.serial.last-port.v1';
export const AUTO_CONNECT_STORAGE_KEY = 'kerfdesk.serial.auto-connect.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The remembered port. VID/PID name the USB adapter model, not the unit;
 *  the grant itself (Chrome's, or the desktop app's for the run) is what ties
 *  a port to the one the operator picked. */
export type RememberedSerialPort = SerialPortIdentity;

export type GrantedPortChoice =
  | { readonly kind: 'use'; readonly port: SerialPortRef }
  | { readonly kind: 'ask'; readonly reason: 'none' | 'several' | 'different' };

/**
 * Pick the port Connect opens without showing the picker. A granted port is
 * one the operator picked in this browser or app before. With a remembered
 * adapter, exactly one granted port of that adapter is used; with none, a
 * lone granted port is. Anything else asks, so a second machine or two
 * identical adapters never connect by guess.
 */
export function chooseGrantedPort(
  granted: ReadonlyArray<SerialPortRef>,
  remembered: RememberedSerialPort | null,
): GrantedPortChoice {
  if (granted.length === 0) return { kind: 'ask', reason: 'none' };
  if (remembered !== null && hasUsbIdentity(remembered)) {
    const matches = granted.filter((port) => sameAdapter(port.info, remembered));
    if (matches.length === 1 && matches[0] !== undefined) return { kind: 'use', port: matches[0] };
    return { kind: 'ask', reason: matches.length === 0 ? 'different' : 'several' };
  }
  if (granted.length === 1 && granted[0] !== undefined) return { kind: 'use', port: granted[0] };
  return { kind: 'ask', reason: 'several' };
}

function hasUsbIdentity(identity: SerialPortIdentity): boolean {
  return identity.usbVendorId !== undefined && identity.usbProductId !== undefined;
}

function sameAdapter(
  info: SerialPortIdentity | undefined,
  remembered: RememberedSerialPort,
): boolean {
  return (
    info !== undefined &&
    info.usbVendorId === remembered.usbVendorId &&
    info.usbProductId === remembered.usbProductId
  );
}

export function loadRememberedSerialPort(storage: StorageLike | null): RememberedSerialPort | null {
  const raw = readItem(storage, SERIAL_PORT_MEMORY_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const usbVendorId = usbId(record['usbVendorId']);
    const usbProductId = usbId(record['usbProductId']);
    return {
      ...(usbVendorId === undefined ? {} : { usbVendorId }),
      ...(usbProductId === undefined ? {} : { usbProductId }),
    };
  } catch {
    return null;
  }
}

export function rememberSerialPort(
  storage: StorageLike | null,
  identity: SerialPortIdentity | null,
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      SERIAL_PORT_MEMORY_STORAGE_KEY,
      JSON.stringify({
        ...(identity?.usbVendorId === undefined ? {} : { usbVendorId: identity.usbVendorId }),
        ...(identity?.usbProductId === undefined ? {} : { usbProductId: identity.usbProductId }),
      }),
    );
  } catch {
    // A full or blocked store only costs the next Connect one picker.
  }
}

export function forgetRememberedSerialPort(storage: StorageLike | null): void {
  try {
    storage?.removeItem(SERIAL_PORT_MEMORY_STORAGE_KEY);
  } catch {
    // Nothing to undo: a store that cannot be written holds no memory either.
  }
}

/** On unless the operator turned it off. It only ever opens a port the
 *  operator picked before, and the connection reads settings and moves
 *  nothing (ADR-420). */
export function loadAutoConnectPreference(storage: StorageLike | null): boolean {
  return readItem(storage, AUTO_CONNECT_STORAGE_KEY) !== 'off';
}

export function saveAutoConnectPreference(storage: StorageLike | null, enabled: boolean): void {
  try {
    storage?.setItem(AUTO_CONNECT_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // The choice then lasts for this session only.
  }
}

export function usbIdLabel(identity: SerialPortIdentity | null | undefined): string | null {
  if (identity?.usbVendorId === undefined || identity.usbProductId === undefined) return null;
  return `${hex4(identity.usbVendorId)}:${hex4(identity.usbProductId)}`;
}

function hex4(value: number): string {
  return value.toString(16).padStart(4, '0');
}

function usbId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff
    ? value
    : undefined;
}

function readItem(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
