import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export type RemoteIdentity = {
  readonly schemaVersion: 1;
  readonly deviceId: string;
  readonly ownerSecret: string;
  readonly enabled: boolean;
  readonly revokeOnConnect: boolean;
  readonly pendingRevocations: string[];
};
type SecureStorage = {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  getSelectedStorageBackend(): string;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
};

export function validRemoteIdentity(value: unknown): value is RemoteIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<RemoteIdentity>;
  return (
    item.schemaVersion === 1 &&
    typeof item.deviceId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.deviceId) &&
    typeof item.ownerSecret === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(item.ownerSecret) &&
    typeof item.enabled === 'boolean' &&
    typeof item.revokeOnConnect === 'boolean' &&
    validPendingRevocations(item.pendingRevocations)
  );
}
function validPendingRevocations(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every(
      (id) =>
        typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
    ) &&
    new Set(value).size === value.length
  );
}

/** Separate from licensing: no credential ever falls back to a plaintext file. */
export function createRemoteCredentialStore(options: {
  readonly userDataPath: string;
  readonly platform: string;
  readonly secureStorage: SecureStorage;
}) {
  const file = join(options.userDataPath, 'remote-control.v1');
  const secure = options.secureStorage;
  const check = async (): Promise<void> => {
    if (
      !(await secure.isAsyncEncryptionAvailable()) ||
      (options.platform === 'linux' &&
        !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
          secure.getSelectedStorageBackend(),
        ))
    )
      throw new Error('Secure remote credential storage is unavailable.');
  };
  const write = async (value: RemoteIdentity): Promise<void> => {
    if (!validRemoteIdentity(value)) throw new Error('Invalid remote settings.');
    await check();
    const encrypted = await secure.encryptStringAsync(JSON.stringify(value));
    await mkdir(options.userDataPath, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(encrypted);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  };
  return {
    write,
    async read(): Promise<RemoteIdentity | null> {
      await check();
      let handle;
      try {
        handle = await open(file, 'r');
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return null;
        throw new Error('Saved remote settings are unavailable.');
      }
      let encrypted: Buffer;
      try {
        if ((await handle.stat()).size > 8192)
          throw new Error('Saved remote settings are unavailable.');
        const bounded = Buffer.alloc(8193);
        const read = await handle.read(bounded, 0, bounded.length, 0);
        if (read.bytesRead > 8192) throw new Error('Saved remote settings are unavailable.');
        encrypted = bounded.subarray(0, read.bytesRead);
      } finally {
        await handle.close();
      }
      const decrypted = await secure.decryptStringAsync(encrypted);
      const value: unknown = JSON.parse(decrypted.result);
      if (!validRemoteIdentity(value)) throw new Error('Saved remote settings are unavailable.');
      if (decrypted.shouldReEncrypt) await write(value);
      return value;
    },
    create: (): RemoteIdentity => ({
      schemaVersion: 1,
      deviceId: randomUUID(),
      ownerSecret: randomBytes(32).toString('base64url'),
      enabled: false,
      revokeOnConnect: false,
      pendingRevocations: [],
    }),
  };
}

export type RemoteCredentialStore = ReturnType<typeof createRemoteCredentialStore>;
