import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { record, type SignedEntitlement } from './licensing-verification.js';
import { validLicencePayment, type LicencePayment } from './licensing-commerce.js';

export type LicenceCredential = {
  readonly entitlement: SignedEntitlement;
  readonly activationToken: string;
};
export type LicenceRecord = {
  readonly schemaVersion: 1;
  readonly lastSeenAt: number;
  /** Last time the licence service confirmed this device's rights. */
  readonly refreshedAt?: number;
  readonly credential?: LicenceCredential;
  /** Kept with the credential so a buyer can read it back for their other devices. */
  readonly licenseKey?: string;
  readonly pendingDeactivation?: LicenceCredential;
  readonly payment?: LicencePayment;
};
export type LicensingStore = {
  readonly read: () => Promise<LicenceRecord | null>;
  readonly write: (value: LicenceRecord) => Promise<void>;
  /**
   * Sets an unreadable record aside without needing the keychain that failed to
   * open it. The newest few are kept for support; nothing is deleted outright.
   */
  readonly reset: () => Promise<void>;
};

const FILE_NAME = 'commercial-licence.v1';
const SET_ASIDE = `${FILE_NAME}.unreadable-`;
/** How many unreadable records are kept beside the licence file; the oldest go first. */
const SET_ASIDE_KEPT = 3;

/** The saved record exists but cannot be decrypted or parsed; resetting it is safe. */
export class LicenceStoreUnreadableError extends Error {
  constructor() {
    super('The saved licence could not be read.');
  }
}

export function validLicenceKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/[\p{Cc}\p{Cf}\s]/u.test(value)
  );
}
type SecureStorage = {
  readonly isAsyncEncryptionAvailable: () => Promise<boolean>;
  readonly getSelectedStorageBackend: () => string;
  readonly encryptStringAsync: (value: string) => Promise<Buffer>;
  readonly decryptStringAsync: (
    value: Buffer,
  ) => Promise<{ result: string; shouldReEncrypt: boolean }>;
};

function validCredential(value: unknown): value is LicenceCredential {
  return (
    record(value) &&
    record(value.entitlement) &&
    typeof value.activationToken === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value.activationToken)
  );
}

function parseRecord(value: unknown): LicenceRecord {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.lastSeenAt) ||
    (value.lastSeenAt as number) < 0 ||
    !validSavedExtras(value) ||
    !validCredentialState(value) ||
    (value.payment !== undefined && !validLicencePayment(value.payment))
  ) {
    throw new Error('The saved licence could not be read. Contact KerfDesk support.');
  }
  return value as LicenceRecord;
}

function validSavedExtras(value: Record<string, unknown>): boolean {
  const refreshed = value.refreshedAt;
  if (refreshed !== undefined && (!Number.isSafeInteger(refreshed) || (refreshed as number) < 0))
    return false;
  return value.licenseKey === undefined || validLicenceKey(value.licenseKey);
}

function validCredentialState(value: Record<string, unknown>): boolean {
  if (value.credential !== undefined && !validCredential(value.credential)) return false;
  if (value.pendingDeactivation !== undefined && !validCredential(value.pendingDeactivation))
    return false;
  return value.credential === undefined || value.pendingDeactivation === undefined;
}

export function createLicensingStore(options: {
  readonly userDataPath: string;
  readonly secureStorage: SecureStorage;
  readonly platform: string;
}): LicensingStore {
  const file = join(options.userDataPath, FILE_NAME);
  const secure = options.secureStorage;
  const check = async (): Promise<void> => {
    if (
      !(await secure.isAsyncEncryptionAvailable()) ||
      (options.platform === 'linux' &&
        !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
          secure.getSelectedStorageBackend(),
        ))
    ) {
      throw new Error(
        'Secure operating-system credential storage is unavailable. Unlock your keychain or password manager and try again.',
      );
    }
  };
  const write = async (value: LicenceRecord): Promise<void> => {
    await check();
    const encrypted = await secure.encryptStringAsync(JSON.stringify(parseRecord(value)));
    await mkdir(options.userDataPath, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeDurably(temporary, encrypted);
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  };
  return {
    write,
    read: async () => {
      await check();
      let encrypted: Buffer;
      try {
        encrypted = await readBoundedCredential(file);
      } catch (error) {
        if (record(error) && error.code === 'ENOENT') return null;
        throw error;
      }
      let decrypted: { result: string; shouldReEncrypt: boolean };
      let value: LicenceRecord;
      try {
        decrypted = await secure.decryptStringAsync(encrypted);
        value = parseRecord(JSON.parse(decrypted.result));
      } catch {
        // A changed OS account key, a corrupt file or an older format. The
        // caller offers a reset; the server keeps this device's seat for reuse.
        throw new LicenceStoreUnreadableError();
      }
      if (decrypted.shouldReEncrypt) await write(value);
      return value;
    },
    reset: () => setAside(options.userDataPath),
  };
}

/** Writes and flushes to disk, so a power cut after the rename cannot leave a torn licence. */
async function writeDurably(path: string, data: Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Renames an unreadable licence to `commercial-licence.v1.unreadable-<time>`.
 * If the operating-system key comes back, support can still read it. Room is
 * made first, so the copy just set aside survives even with a wrong clock.
 */
async function setAside(directory: string): Promise<void> {
  const names: string[] = await readdir(directory).catch((error: unknown) => {
    if (record(error) && error.code === 'ENOENT') return [];
    throw error;
  });
  if (!names.includes(FILE_NAME)) return;
  const older = names.filter((name) => name.startsWith(SET_ASIDE)).sort();
  for (const name of older.slice(0, Math.max(0, older.length - (SET_ASIDE_KEPT - 1))))
    await unlink(join(directory, name)).catch(() => undefined);
  const time = new Date().toISOString().replace(/[:.]/g, '-');
  await rename(join(directory, FILE_NAME), join(directory, `${SET_ASIDE}${time}`));
}

async function readBoundedCredential(file: string): Promise<Buffer> {
  const handle = await open(file, 'r');
  const buffer = Buffer.alloc(131_073);
  let length = 0;
  try {
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > 131_072) throw new LicenceStoreUnreadableError();
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}
