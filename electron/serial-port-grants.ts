// The serial ports the operator picked, remembered across restarts in the
// Windows desktop app (ADR-552), as Chrome remembers them. Electron keeps picks
// in memory for the run. Once a device permission handler is installed,
// Electron 44 asks it about every port it could remember and stops recording
// picks itself (shell/browser/serial/serial_chooser_context.cc and
// shell/browser/electron_permission_manager.cc, ADR-366). So this record is
// the only grant for such a port: main adds each port picked in the Select
// dialog, the handler answers from it, and Forget removes the port. A port
// Electron cannot remember (no device instance ID) stays Electron's own pick
// for the run and never reaches the handler.

import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const SERIAL_PORT_GRANTS_FILE = 'serial-port-grants.json';
/** Enough for every machine in a shop; the oldest pick goes first. */
export const MAX_REMEMBERED_SERIAL_PORTS = 16;
const MAX_ID_LENGTH = 512;
const MAX_FILE_BYTES = 64 * 1024;

/** One remembered port: its Windows device instance ID and when it was picked. */
export type SerialPortGrant = { readonly id: string; readonly pickedAt: number };

export class SerialPortGrants {
  readonly #remembered = new Map<string, SerialPortGrant>();
  // Chromium's own Bluetooth serial ports have no device instance ID. Their
  // port name is the Bluetooth address that Electron asks the handler about.
  // They are kept for the run only, as before.
  readonly #bluetoothAddresses = new Set<string>();

  constructor(
    saved: ReadonlyArray<SerialPortGrant>,
    private readonly save: (grants: ReadonlyArray<SerialPortGrant>) => void,
  ) {
    const newestLast = [...saved].sort((a, b) => a.pickedAt - b.pickedAt);
    for (const grant of newestLast) this.#remember(grant);
  }

  /** The operator picked `port`, an Electron SerialPort, in the Select dialog. */
  recordPick(port: unknown, now: number = Date.now()): void {
    const id = boundedString(port, 'deviceInstanceId');
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
    const id = boundedString(device, 'device_instance_id');
    if (id !== null) return this.#remembered.has(key(id));
    const address = boundedString(device, 'bluetooth_device_path');
    return address !== null && this.#bluetoothAddresses.has(address);
  }

  /** The window forgot `port` (Forget Controller). */
  revoke(port: unknown): void {
    const id = boundedString(port, 'deviceInstanceId');
    if (id === null) {
      const address = boundedString(port, 'portName');
      if (address !== null) this.#bluetoothAddresses.delete(address);
      return;
    }
    if (this.#remembered.delete(key(id))) this.save(this.list());
  }

  /** The Select dialog's default: the listed port picked most recently, else the first. */
  preferredIndex(ports: ReadonlyArray<unknown>): number {
    const recency = [...this.#remembered.keys()];
    let best = 0;
    let bestRank = -1;
    ports.forEach((port, index) => {
      const id = boundedString(port, 'deviceInstanceId');
      const rank = id === null ? -1 : recency.indexOf(key(id));
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
    this.#remembered.delete(key(grant.id));
    this.#remembered.set(key(grant.id), grant);
    for (const oldest of this.#remembered.keys()) {
      if (this.#remembered.size <= MAX_REMEMBERED_SERIAL_PORTS) break;
      this.#remembered.delete(oldest);
    }
  }
}

// Windows compares device instance IDs without regard to case.
function key(id: string): string {
  return id.toUpperCase();
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
