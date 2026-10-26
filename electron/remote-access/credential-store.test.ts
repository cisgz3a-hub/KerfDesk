// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRemoteCredentialStore,
  RemoteStorageUnavailableError,
  validRemoteIdentity,
} from './credential-store.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'kerfdesk-remote-test-'));
});
afterEach(async () => {
  const target = resolve(directory);
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !basename(target).startsWith('kerfdesk-remote-test-')
  )
    throw new Error('Unexpected test cleanup target');
  await rm(target, { recursive: true, force: true });
});

// Ephemeral authenticated encryption exercises the file contract, not Windows DPAPI qualification.
// `tag` is the key provider's ciphertext prefix: v11 a Secret Service, v10 the fallback key.
function storage(tag: string) {
  const key = randomBytes(32);
  return {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (value: string) => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from(tag), nonce, cipher.getAuthTag(), ciphertext]);
    }),
    decryptStringAsync: vi.fn(async (value: Buffer) => {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(3, 15));
      decipher.setAuthTag(value.subarray(15, 31));
      const plaintext = Buffer.concat([decipher.update(value.subarray(31)), decipher.final()]);
      return { result: plaintext.toString('utf8'), shouldReEncrypt: false };
    }),
  };
}
function fixture(platform = 'win32', tag = 'v11') {
  const secureStorage = storage(tag);
  const store = createRemoteCredentialStore({ userDataPath: directory, platform, secureStorage });
  return { store, secureStorage, file: join(directory, 'remote-control.v1') };
}

describe('separate encrypted remote credentials', () => {
  it('survives a new store instance and retains disabled/revocation state without plaintext', async () => {
    const { store, secureStorage, file } = fixture();
    expect(await store.read()).toBeNull();
    const identity = { ...store.create(), enabled: true, pendingRevocations: [randomUUID()] };
    await store.write(identity);
    const bytes = await readFile(file);
    expect(bytes.toString()).not.toContain(identity.ownerSecret);
    expect(bytes.toString()).not.toContain(identity.deviceId);
    const restarted = createRemoteCredentialStore({
      userDataPath: directory,
      platform: 'win32',
      secureStorage,
    });
    expect(await restarted.read()).toEqual(identity);
    await restarted.write({ ...identity, enabled: false, revokeOnConnect: true });
    expect(await store.read()).toEqual({ ...identity, enabled: false, revokeOnConnect: true });
    expect(await readdir(directory)).toEqual(['remote-control.v1']);
  });

  it('discards the saved record without secure storage, so nothing reconnects with it', async () => {
    const { store, secureStorage } = fixture();
    await store.write({ ...store.create(), enabled: true });
    secureStorage.isAsyncEncryptionAvailable.mockResolvedValue(false);
    expect(await store.discard()).toBe(true);
    expect(await readdir(directory)).toEqual([]);
    expect(await store.discard()).toBe(true);
    secureStorage.isAsyncEncryptionAvailable.mockResolvedValue(true);
    expect(await store.read()).toBeNull();
  });

  it('reports a record it could not remove', async () => {
    const { store, file } = fixture();
    // Something that cannot be unlinked stands where the record lives.
    await mkdir(file);
    expect(await store.discard()).toBe(false);
  });

  it('keeps the previous encrypted record when encryption fails', async () => {
    const { store, secureStorage, file } = fixture();
    const identity = store.create();
    await store.write(identity);
    const original = await readFile(file);
    secureStorage.encryptStringAsync.mockRejectedValueOnce(new Error('unavailable'));
    await expect(store.write({ ...identity, enabled: true })).rejects.toThrow();
    expect(await readFile(file)).toEqual(original);
    expect(await store.read()).toEqual(identity);
    expect(await readdir(directory)).toEqual(['remote-control.v1']);
  });

  it('refuses the Linux fallback key, whatever backend Electron names, and never writes', async () => {
    // A GNOME desktop with no keyring running still encrypts, under the shared v10 key.
    const { store, secureStorage } = fixture('linux', 'v10');
    const identity = store.create();
    await expect(store.write(identity)).rejects.toThrow('Secure remote');
    await expect(store.read()).rejects.toThrow('Secure remote');
    // Only the one probe was encrypted, never the identity.
    expect(secureStorage.encryptStringAsync).toHaveBeenCalledOnce();
    expect(secureStorage.encryptStringAsync).not.toHaveBeenCalledWith(
      expect.stringContaining(identity.ownerSecret),
    );
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(['v11', 'v12'])(
    'keeps Linux credentials under a %s keyring key on any desktop, probing once',
    async (tag) => {
      // A tiling window manager reports basic_text yet reaches a running Secret Service.
      const { store, secureStorage, file } = fixture('linux', tag);
      const identity = store.create();
      expect(await store.read()).toBeNull();
      await store.write(identity);
      expect(await store.read()).toEqual(identity);
      expect((await readFile(file)).subarray(0, 3).toString()).toBe(tag);
      // The probe and the identity: the provider cannot change within a process.
      expect(secureStorage.encryptStringAsync).toHaveBeenCalledTimes(2);
    },
  );

  it('asks the Linux keyring again after a probe that failed outright', async () => {
    const { store, secureStorage } = fixture('linux');
    secureStorage.encryptStringAsync.mockRejectedValueOnce(new Error('bus closed'));
    // The runtime reads again at the next attach only for this refusal.
    await expect(store.read()).rejects.toBeInstanceOf(RemoteStorageUnavailableError);
    expect(await store.read()).toBeNull();
  });

  it('fails closed for unavailable storage, oversized files and modified ciphertext', async () => {
    const { store, secureStorage, file } = fixture();
    secureStorage.isAsyncEncryptionAvailable.mockResolvedValueOnce(false);
    await expect(store.write(store.create())).rejects.toThrow('Secure remote');
    await writeFile(file, Buffer.alloc(8193));
    await expect(store.read()).rejects.toThrow();
    expect(secureStorage.decryptStringAsync).not.toHaveBeenCalled();
    await store.write(store.create());
    const bytes = await readFile(file);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    await writeFile(file, bytes);
    await expect(store.read()).rejects.toThrow();
  });

  it('rejects invalid or duplicate saved revocations', () => {
    const { store } = fixture();
    const identity = store.create();
    const id = randomUUID();
    expect(validRemoteIdentity(identity)).toBe(true);
    expect(validRemoteIdentity({ ...identity, pendingRevocations: [id, id] })).toBe(false);
    expect(validRemoteIdentity({ ...identity, pendingRevocations: ['-'.repeat(36)] })).toBe(false);
    expect(validRemoteIdentity({ ...identity, ownerSecret: 'short' })).toBe(false);
  });
});
