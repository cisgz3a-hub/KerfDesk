// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import { createLicensingStore } from './licensing-store';
import { harness, NOW, saved } from './licensing-runtime.test-support';

// Oracle audit O1, O3-P3-4 (rolling v2 P3-9): Electron's safeStorage may ask for a record to be
// re-encrypted under the current OS key. That rewrite is housekeeping; when it
// fails, the paid licence that just decrypted must stay usable (ADR-623 Amd 2).

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function reEncryptingStore() {
  const folder = await mkdtemp(join(tmpdir(), 'kerfdesk-licence-reencrypt-'));
  folders.push(folder);
  const state = { reEncrypt: false, encryptFails: false, encrypted: 0 };
  const store = createLicensingStore({
    userDataPath: folder,
    platform: 'win32',
    secureStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (value: string) => {
        if (state.encryptFails) throw new Error('The key provider refused the rewrite');
        state.encrypted += 1;
        return Buffer.from(value);
      },
      decryptStringAsync: async (value: Buffer) => ({
        result: value.toString(),
        shouldReEncrypt: state.reEncrypt,
      }),
    },
  });
  return { store, state };
}

describe('licence store re-encryption', () => {
  it('keeps a paid licence usable when the re-encryption rewrite fails', async () => {
    const { store, state } = await reEncryptingStore();
    await store.write({ ...saved(), refreshedAt: NOW / 1000 });
    state.reEncrypt = true;
    state.encryptFails = true;
    expect((await store.read())?.credential).toBeDefined();
    const h = harness();
    h.fetch.mockRejectedValue(new Error('offline'));
    const status = await createLicensingRuntime({ ...h.options, store }).status();
    expect(status).toMatchObject({ state: 'ready', edition: 'pro', tier: 'paid' });
  });

  it('still re-encrypts when the operating system asks and the rewrite succeeds', async () => {
    const { store, state } = await reEncryptingStore();
    await store.write({ ...saved(), refreshedAt: NOW / 1000 });
    const written = state.encrypted;
    state.reEncrypt = true;
    expect((await store.read())?.credential).toBeDefined();
    expect(state.encrypted).toBe(written + 1);
  });
});
