// The serial ports the operator picked, remembered across restarts in the
// desktop app (ADR-552, ADR-607), as Chrome remembers them. Electron keeps picks
// in memory for the run. Once a device permission handler is installed,
// Electron 44 asks it about every port it could remember and stops recording
// picks itself (shell/browser/serial/serial_chooser_context.cc and
// shell/browser/electron_permission_manager.cc, ADR-366). So this record is
// the only grant for such a port: main adds each port picked in the Select
// dialog, the handler answers from it, and Forget removes the port. A port
// Electron cannot remember stays Electron's own pick for the run and never
// reaches the handler.
//
// What identifies a port differs by system, exactly as Electron stores it
// (PortInfoToValue). Windows has a device instance ID. macOS and Linux have the
// USB vendor ID, product ID and serial number, and macOS adds the USB driver
// name, because its built-in driver and a vendor's driver can both list one
// adapter. An adapter with no serial number (most CH340 boards) cannot be
// remembered there, in Chrome or here, and is picked again after each start.

import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const SERIAL_PORT_GRANTS_FILE = 'serial-port-grants.json';
/** Enough for every machine in a shop; the oldest pick goes first. */
export const MAX_REMEMBERED_SERIAL_PORTS = 16;
const MAX_ID_LENGTH = 512;
const MAX_FILE_BYTES = 64 * 1024;

/** One remembered port: its identity on this system and when it was picked. */
export type SerialPortGrant = { readonly id: string; readonly pickedAt: number };

/** How one system names a port: in an Electron SerialPort, and in Electron's stored form. */
export type SerialPortIdentity = {
  readonly fromPort: (port: unknown) => string | null;
  readonly fromStored: (device: unknown) => string | null;
  /** The same port's ids compare equal through this. */
  readonly key: (id: string) => string;
};

const WINDOWS_IDENTITY: SerialPortIdentity = {
  fromPort: (port) => boundedString(port, 'deviceInstanceId'),
  fromStored: (device) => boundedString(device, 'device_instance_id'),
  // Windows compares device instance IDs without regard to case.
  key: (id) => id.toUpperCase(),
};

function usbIdentity(withDriver: boolean): SerialPortIdentity {
  return {
    fromPort: (port) =>
      usbId(
        decimalId(port, 'vendorId'),
        decimalId(port, 'productId'),
        boundedString(port, 'serialNumber'),
        withDriver ? boundedString(port, 'usbDriverName') : '',
      ),
    fromStored: (device) =>
      usbId(
        integerId(device, 'vendor_id'),
        integerId(device, 'product_id'),
        boundedString(device, 'serial_number'),
        withDriver ? boundedString(device, 'usb_driver') : '',
      ),
    key: (id) => id,
  };
}

/** The identity Electron remembers ports by on `platform`, or null where it remembers none. */
export function serialPortIdentity(platform: NodeJS.Platform): SerialPortIdentity | null {
  if (platform === 'win32') return WINDOWS_IDENTITY;
  if (platform === 'darwin') return usbIdentity(true);
  if (platform === 'linux') return usbIdentity(false);
  return null;
}

export class SerialPortGrants {
  readonly #remembered = new Map<string, SerialPortGrant>();
  // Chromium's own Bluetooth serial ports have no device instance ID. Their
  // port name is the Bluetooth address that Electron asks the handler about.
  // They are kept for the run only, as before.
  readonly #bluetoothAddresses = new Set<string>();

  constructor(
    saved: ReadonlyArray<SerialPortGrant>,
    private readonly save: (grants: ReadonlyArray<SerialPortGrant>) => void,
    private readonly identity: SerialPortIdentity = WINDOWS_IDENTITY,
  ) {
    const newestLast = [...saved].sort((a, b) => a.pickedAt - b.pickedAt);
    for (const grant of newestLast) this.#remember(grant);
  }

  /** The operator picked `port`, an Electron SerialPort, in the Select dialog. */
  recordPick(port: unknown, now: number = Date.now()): void {
    // Electron remembers no port without a display name on any system
    // (CanStorePersistentEntry): it keeps that pick for the run itself and never
    // asks the handler, so a record of it would only promise what cannot happen.
    if (boundedString(port, 'displayName') === null) return;
    const id = this.identity.fromPort(port);
    if (id !== null) {
      this.#remember({ id, pickedAt: now });
      this.save(this.list());
      return;
    }
    const address = boundedString(port, 'portName');
    if (address !== null) this.#bluetoothAddresses.add(address);
  }

  /** Electron's question about a port it can remember, as its stored form. */
  allows(device: unknown): boolean {
    const id = this.identity.fromStored(device);
    if (id !== null) return this.#remembered.has(this.identity.key(id));
    const address = boundedString(device, 'bluetooth_device_path');
    return address !== null && this.#bluetoothAddresses.has(address);
  }

  /** The window forgot `port` (Forget Controller). */
  revoke(port: unknown): void {
    const id = this.identity.fromPort(port);
    if (id === null) {
      const address = boundedString(port, 'portName');
      if (address !== null) this.#bluetoothAddresses.delete(address);
      return;
    }
    if (this.#remembered.delete(this.identity.key(id))) this.save(this.list());
  }

  /** The Select dialog's default: the listed port picked most recently, else the first. */
  preferredIndex(ports: ReadonlyArray<unknown>): number {
    const recency = [...this.#remembered.keys()];
    let best = 0;
    let bestRank = -1;
    ports.forEach((port, index) => {
      const id = this.identity.fromPort(port);
      const rank = id === null ? -1 : recency.indexOf(this.identity.key(id));
      if (rank > bestRank) {
        best = index;
        bestRank = rank;
      }
    });
    return best;
  }

  /** Oldest pick first. */
  list(): ReadonlyArray<SerialPortGrant> {
    return [...this.#remembered.values()];
  }

  #remember(grant: SerialPortGrant): void {
    const key = this.identity.key(grant.id);
    this.#remembered.delete(key);
    this.#remembered.set(key, grant);
    for (const oldest of this.#remembered.keys()) {
      if (this.#remembered.size <= MAX_REMEMBERED_SERIAL_PORTS) break;
      this.#remembered.delete(oldest);
    }
  }
}

// One string for the USB fields, unambiguous whatever the serial number holds.
function usbId(
  vendor: number | null,
  product: number | null,
  serial: string | null,
  driver: string | null,
): string | null {
  if (vendor === null || product === null || serial === null || driver === null) return null;
  const id = JSON.stringify(
    driver === '' ? [vendor, product, serial] : [vendor, product, serial, driver],
  );
  return id.length <= MAX_ID_LENGTH ? id : null;
}

// Electron's SerialPort gives USB IDs as decimal text ("6790").
function decimalId(value: unknown, field: string): number | null {
  const text = boundedString(value, field);
  return text !== null && /^\d{1,5}$/.test(text) ? usbNumber(Number(text)) : null;
}

// Its stored form gives them as numbers.
function integerId(value: unknown, field: string): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const number: unknown = (value as Record<string, unknown>)[field];
  return typeof number === 'number' ? usbNumber(number) : null;
}

function usbNumber(value: number): number | null {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : null;
}

function boundedString(value: unknown, field: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const text: unknown = (value as Record<string, unknown>)[field];
  return typeof text === 'string' && text.length > 0 && text.length <= MAX_ID_LENGTH ? text : null;
}

/** Only an exact, current-format file counts; anything else remembers nothing. */
export function parseSerialPortGrants(text: string): SerialPortGrant[] {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return [];
    const { schemaVersion, ports } = value as Record<string, unknown>;
    if (schemaVersion !== 1 || !Array.isArray(ports)) return [];
    return ports.flatMap((port: unknown) => {
      const id = boundedString(port, 'id');
      const pickedAt = id === null ? undefined : (port as { pickedAt?: unknown }).pickedAt;
      return id !== null && typeof pickedAt === 'number' && Number.isFinite(pickedAt)
        ? [{ id, pickedAt }]
        : [];
    });
  } catch {
    return [];
  }
}

/** Read at startup, before the window can ask for its ports. */
export function readSerialPortGrants(file: string): SerialPortGrant[] {
  try {
    if (statSync(file).size > MAX_FILE_BYTES) return [];
    return parseSerialPortGrants(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

/** Saves in order, each write replacing the file whole; a failed save is logged. */
export function serialPortGrantsWriter(
  file: string,
): (grants: ReadonlyArray<SerialPortGrant>) => void {
  let queue = Promise.resolve();
  return (grants) => {
    const body = `${JSON.stringify({ schemaVersion: 1, ports: grants })}\n`;
    queue = queue
      .then(() => replaceFile(file, body))
      .catch((error: unknown) => console.warn('[serial] Could not save remembered ports:', error));
  };
}

async function replaceFile(file: string, body: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
