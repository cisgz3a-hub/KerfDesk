import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
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
  /** Removes an unreadable record without needing the keychain that failed to open it. */
  readonly reset: () => Promise<void>;
};

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
  const file = join(options.userDataPath, 'commercial-licence.v1');
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
      await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 });
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
    reset: async () => {
      await unlink(file).catch((error: unknown) => {
        if (!(record(error) && error.code === 'ENOENT')) throw error;
      });
    },
  };
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
