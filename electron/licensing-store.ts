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
  readonly credential?: LicenceCredential;
  readonly pendingDeactivation?: LicenceCredential;
  readonly payment?: LicencePayment;
};
export type LicensingStore = {
  readonly read: () => Promise<LicenceRecord | null>;
  readonly write: (value: LicenceRecord) => Promise<void>;
};
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
    !validCredentialState(value) ||
    (value.payment !== undefined && !validLicencePayment(value.payment))
  ) {
    throw new Error('The saved licence could not be read. Contact KerfDesk support.');
  }
  return value as LicenceRecord;
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
      if (encrypted.length > 131_072) throw new Error('The saved licence is invalid.');
      const decrypted = await secure.decryptStringAsync(encrypted);
      const value = parseRecord(JSON.parse(decrypted.result));
      if (decrypted.shouldReEncrypt) await write(value);
      return value;
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
    if (length > 131_072) throw new Error('The saved licence is invalid.');
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}
