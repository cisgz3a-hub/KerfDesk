import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createSecureStorageCheck } from './secure-storage-check.js';

type SecureStorage = {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
};

const FILE_NAME = 'camera-address.v1';
const MAX_FILE_BYTES = 16_384;
export const MAX_CAMERA_ADDRESS_LENGTH = 4096;

/** The remembered camera addresses: the RTSP camera's and the phone camera's. */
export type CameraAddressSlot = 'rtsp' | 'phone';
export const CAMERA_ADDRESS_SLOTS: ReadonlySet<string> = new Set(['rtsp', 'phone']);

const SLOT_SCHEME: Readonly<Record<CameraAddressSlot, RegExp>> = {
  rtsp: /^rtsps?:\/\//i,
  phone: /^https?:\/\//i,
};

/** An address the window may hand over for `slot`: its scheme, bounded, no control characters. */
export function validRememberedCameraAddress(
  slot: CameraAddressSlot,
  value: unknown,
): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_CAMERA_ADDRESS_LENGTH &&
    SLOT_SCHEME[slot].test(value) &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

type Kept = Partial<Record<CameraAddressSlot, string>>;

/**
 * The remembered camera addresses in the form a reconnect needs, login
 * included for RTSP, kept only under the operating system's encryption
 * (ADR-692 and Amendment 1). Without secure storage nothing is kept: there is
 * never a plain-text fallback, and the window remembers only the public
 * address. Every failure reads as "nothing kept".
 */
export function createCameraAddressStore(options: {
  readonly userDataPath: string;
  readonly platform: string;
  readonly secureStorage: SecureStorage;
}) {
  const file = join(options.userDataPath, FILE_NAME);
  const secure = options.secureStorage;
  // On Linux, only a keyring's key counts, never the shared fallback key.
  const available = createSecureStorageCheck(secure, options.platform);
  // One change at a time, so the latest Connect's address always wins.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  const forget = async (): Promise<void> => {
    await unlink(file).catch(() => undefined);
  };
  const keepAll = async (kept: Kept): Promise<void> => {
    if (Object.keys(kept).length === 0) return forget();
    const bytes = await secure.encryptStringAsync(JSON.stringify(kept));
    await mkdir(options.userDataPath, { recursive: true });
    await writeAtomically(file, bytes);
  };
  const readAll = async (): Promise<Kept> => {
    if (!(await available())) return {};
    const bytes = await readBounded(file);
    if (bytes === null) return {};
    return keptAddresses(JSON.parse((await secure.decryptStringAsync(bytes)).result));
  };

  return {
    /** Keep `address` for `slot`, or forget it with null; true only when it was kept. */
    write: (slot: CameraAddressSlot, address: string | null): Promise<boolean> =>
      serial(async () => {
        try {
          if (!(await available())) {
            await forget();
            return false;
          }
          const kept = await readAll().catch((): Kept => ({}));
          const next: Kept = {};
          for (const other of ['rtsp', 'phone'] as const) {
            const value = other === slot ? address : (kept[other] ?? null);
            if (value !== null) next[other] = value;
          }
          await keepAll(next);
          return address !== null;
        } catch {
          await forget();
          return false;
        }
      }),
    read: (slot: CameraAddressSlot): Promise<string | null> =>
      serial(async () => (await readAll().catch((): Kept => ({})))[slot] ?? null),
  };
}

export type CameraAddressStore = ReturnType<typeof createCameraAddressStore>;

async function writeAtomically(file: string, bytes: Buffer): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

// The file's bytes, or null when it is missing or larger than it can be.
async function readBounded(file: string): Promise<Buffer | null> {
  const handle = await open(file, 'r').catch(() => null);
  if (handle === null) return null;
  try {
    const bounded = Buffer.alloc(MAX_FILE_BYTES + 1);
    const read = await handle.read(bounded, 0, bounded.length, 0);
    return read.bytesRead > MAX_FILE_BYTES ? null : bounded.subarray(0, read.bytesRead);
  } finally {
    await handle.close();
  }
}

function keptAddresses(value: unknown): Kept {
  if (typeof value !== 'object' || value === null) return {};
  const record = value as Record<string, unknown>;
  const kept: Kept = {};
  for (const slot of ['rtsp', 'phone'] as const) {
    const address = record[slot];
    if (validRememberedCameraAddress(slot, address)) kept[slot] = address;
  }
  return kept;
}
