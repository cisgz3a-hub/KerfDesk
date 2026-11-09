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

/** An RTSP address the window may hand over to keep: rtsp(s), bounded, no control characters. */
export function validRememberedCameraAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_CAMERA_ADDRESS_LENGTH &&
    /^rtsps?:\/\//i.test(value) &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

/**
 * The remembered RTSP camera address in full, login included, kept only under
 * the operating system's encryption (ADR-692). Without secure storage nothing
 * is kept: there is never a plain-text fallback, and the window remembers only
 * the public address. Every failure reads as "nothing kept".
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
  const keep = async (address: string): Promise<boolean> => {
    if (!(await available())) {
      await forget();
      return false;
    }
    const bytes = await secure.encryptStringAsync(JSON.stringify({ rtsp: address }));
    await mkdir(options.userDataPath, { recursive: true });
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
      return true;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  };
  const readKept = async (): Promise<string | null> => {
    if (!(await available())) return null;
    const handle = await open(file, 'r');
    let bytes: Buffer;
    try {
      const bounded = Buffer.alloc(MAX_FILE_BYTES + 1);
      const read = await handle.read(bounded, 0, bounded.length, 0);
      if (read.bytesRead > MAX_FILE_BYTES) return null;
      bytes = bounded.subarray(0, read.bytesRead);
    } finally {
      await handle.close();
    }
    const value: unknown = JSON.parse((await secure.decryptStringAsync(bytes)).result);
    const address =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)['rtsp']
        : null;
    return validRememberedCameraAddress(address) ? address : null;
  };

  return {
    /** Keep `address` in full, or forget it with null; true only when it was kept. */
    write: (address: string | null): Promise<boolean> =>
      serial(async () => {
        if (address === null) {
          await forget();
          return false;
        }
        return keep(address).catch(async () => {
          await forget();
          return false;
        });
      }),
    read: (): Promise<string | null> => serial(() => readKept().catch(() => null)),
  };
}

export type CameraAddressStore = ReturnType<typeof createCameraAddressStore>;
