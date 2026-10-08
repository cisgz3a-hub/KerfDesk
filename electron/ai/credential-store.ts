import { AiFailure } from './failure.js';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { validConfiguration, type AiConfiguration } from './contracts.js';

type SecureStorage = {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  getSelectedStorageBackend(): string;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
};
/** Separate OS-encrypted credentials; absent secure storage never creates a plaintext fallback. */
export function createAiCredentialStore(options: {
  readonly userDataPath: string;
  readonly platform: string;
  readonly secureStorage: SecureStorage;
}) {
  const file = join(options.userDataPath, 'ai-assistant.v1');
  const secure = options.secureStorage;
  const available = async (): Promise<boolean> =>
    (await secure.isAsyncEncryptionAvailable()) &&
    (options.platform !== 'linux' ||
      ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
        secure.getSelectedStorageBackend(),
      ));
  const check = async (): Promise<void> => {
    if (!(await available()))
      throw new AiFailure('Secure assistant credential storage is unavailable.');
  };
  const write = async (value: AiConfiguration): Promise<void> => {
    if (!validConfiguration(value)) throw new AiFailure('Invalid assistant configuration.');
    await check();
    const bytes = await secure.encryptStringAsync(
      JSON.stringify({ apiKey: value.apiKey, model: value.model }),
    );
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
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  };
  return {
    available,
    write,
    async read(): Promise<AiConfiguration | null> {
      await check();
      let handle;
      try {
        handle = await open(file, 'r');
      } catch (error) {
        if (missing(error)) return null;
        throw new AiFailure('Saved assistant configuration is unavailable.');
      }
      let bytes: Buffer;
      try {
        if ((await handle.stat()).size > 16_384)
          throw new AiFailure('Invalid assistant configuration.');
        const bounded = Buffer.alloc(16_385);
        const read = await handle.read(bounded, 0, bounded.length, 0);
        if (read.bytesRead > 16_384) throw new AiFailure('Invalid assistant configuration.');
        bytes = bounded.subarray(0, read.bytesRead);
      } finally {
        await handle.close();
      }
      const decrypted = await secure.decryptStringAsync(bytes);
      const value: unknown = JSON.parse(decrypted.result);
      if (!validConfiguration(value)) throw new AiFailure('Invalid saved assistant configuration.');
      // Reads must not restore a key after a concurrent Configure/Forget. An
      // explicit Save encrypts with the current backend; status never writes.
      return value;
    },
    async forget(): Promise<void> {
      try {
        await unlink(file);
      } catch (error) {
        if (!missing(error)) throw new AiFailure('Could not remove saved assistant credentials.');
      }
    },
  };
}
function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
export type AiCredentialStore = ReturnType<typeof createAiCredentialStore>;
