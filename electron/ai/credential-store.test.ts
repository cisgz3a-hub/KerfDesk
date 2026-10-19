import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiCredentialStore } from './credential-store.js';
import { createAiRuntime } from './runtime.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
/** `tag` is the key provider's ciphertext prefix: v11 a Secret Service, v10 the fallback key. */
async function setup(platform = 'win32', tag = 'v11', available = true) {
  const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-ai-test-'));
  directories.push(directory);
  const secureStorage = {
    isAsyncEncryptionAvailable: vi.fn(async () => available),
    encryptStringAsync: vi.fn(async (text: string) =>
      Buffer.from(tag + text.split('').reverse().join('')),
    ),
    decryptStringAsync: vi.fn(async (bytes: Buffer) => ({
      result: bytes.subarray(3).toString().split('').reverse().join(''),
      shouldReEncrypt: false,
    })),
  };
  return {
    directory,
    secureStorage,
    store: createAiCredentialStore({ userDataPath: directory, platform, secureStorage }),
  };
}
describe('AI credential persistence', () => {
  it('cannot restore a forgotten key when an old decrypt finishes after Configure and Forget', async () => {
    const { directory, store, secureStorage } = await setup();
    const first = { apiKey: 'fake-old-key', model: 'old-model' };
    const second = { apiKey: 'fake-new-key', model: 'new-model' };
    await store.write(first);
    let release: (value: { result: string; shouldReEncrypt: boolean }) => void = () => undefined;
    secureStorage.decryptStringAsync.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const runtime = createAiRuntime(
      store,
      vi.fn(async () => Response.json({})),
    );
    const pending = runtime.status();
    await vi.waitFor(() => expect(secureStorage.decryptStringAsync).toHaveBeenCalledOnce());
    await runtime.configure(second);
    await runtime.forget();
    release({ result: JSON.stringify(first), shouldReEncrypt: true });
    await pending;
    await expect(readFile(join(directory, 'ai-assistant.v1'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await runtime.status()).toEqual({ configured: false, secureStorage: true, model: '' });
    expect(secureStorage.encryptStringAsync).toHaveBeenCalledTimes(2);
  });
  it('stores only secureStorage ciphertext, reopens it, and forgets it independently', async () => {
    const { directory, store, secureStorage } = await setup();
    const value = { apiKey: 'fake-test-key', model: 'mock-model' };
    expect(await store.read()).toBeNull();
    await store.write(value);
    expect(secureStorage.encryptStringAsync).toHaveBeenCalledWith(JSON.stringify(value));
    expect((await readFile(join(directory, 'ai-assistant.v1'))).toString()).not.toContain(
      value.apiKey,
    );
    expect(await store.read()).toEqual(value);
    await store.forget();
    expect(await store.read()).toBeNull();
  });
  it.each([
    ['linux', 'v11', false],
    ['win32', 'v10', false],
  ] as const)('has no plaintext fallback on %s %s', async (platform, tag, available) => {
    const { store, secureStorage } = await setup(platform, tag, available);
    expect(await store.available()).toBe(false);
    await expect(store.write({ apiKey: 'fake', model: 'mock' })).rejects.toThrow('unavailable');
    expect(secureStorage.encryptStringAsync).not.toHaveBeenCalled();
  });
  it('refuses the Linux fallback key, whatever backend Electron names', async () => {
    // A GNOME desktop with no keyring running still encrypts, under the shared v10 key.
    const { directory, store, secureStorage } = await setup('linux', 'v10');
    expect(await store.available()).toBe(false);
    await expect(store.write({ apiKey: 'fake', model: 'mock' })).rejects.toThrow('unavailable');
    await expect(store.read()).rejects.toThrow('unavailable');
    // Only the one probe was encrypted, never the key, and nothing was written.
    expect(secureStorage.encryptStringAsync).toHaveBeenCalledOnce();
    expect(secureStorage.encryptStringAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('fake'),
    );
    await expect(readFile(join(directory, 'ai-assistant.v1'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it.each(['v11', 'v12'])(
    'keeps the key under a Linux %s keyring key on any desktop, probing once',
    async (tag) => {
      // A tiling window manager reports basic_text yet reaches a running Secret Service.
      const { directory, store, secureStorage } = await setup('linux', tag);
      const value = { apiKey: 'fake-test-key', model: 'mock-model' };
      expect(await store.available()).toBe(true);
      await store.write(value);
      expect(await store.read()).toEqual(value);
      expect((await readFile(join(directory, 'ai-assistant.v1'))).subarray(0, 3).toString()).toBe(
        tag,
      );
      // The probe and the key: the provider cannot change within a process.
      expect(secureStorage.encryptStringAsync).toHaveBeenCalledTimes(2);
    },
  );
  it('asks the Linux keyring again after a probe that failed outright', async () => {
    const { store, secureStorage } = await setup('linux');
    secureStorage.encryptStringAsync.mockRejectedValueOnce(new Error('bus closed'));
    expect(await store.available()).toBe(false);
    expect(await store.available()).toBe(true);
    expect(await store.read()).toBeNull();
  });
  it('refuses malformed configuration and oversized existing ciphertext', async () => {
    const { directory, store } = await setup();
    await expect(store.write({ apiKey: 'key\nInjected-header', model: 'mock' })).rejects.toThrow(
      'Invalid',
    );
    await writeFile(join(directory, 'ai-assistant.v1'), Buffer.alloc(16_385));
    await expect(store.read()).rejects.toThrow('Invalid');
  });
});
