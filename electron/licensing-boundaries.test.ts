import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLicensingStore,
  LicenceStoreUnreadableError,
  validLicenceKey,
  type LicenceRecord,
} from './licensing-store';
import { licensingDeviceId } from './licensing-device';
import { withLicensingRoutes } from './licensing-routes';
import { createLicensingRuntime } from './licensing-runtime';
import { licensingRequest } from './licensing-http';

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) {
    if (dirname(path) !== tmpdir()) throw new Error('Unexpected test directory');
    await rm(path, { recursive: true, force: true });
  }
});
async function storage(platform = 'win32', backend = 'gnome_libsecret') {
  const userDataPath = await mkdtemp(join(tmpdir(), 'kerfdesk-licence-test-'));
  temporary.push(userDataPath);
  // Deliberately fake the OS boundary; this is not a claim about native crypto.
  const secureStorage = {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    getSelectedStorageBackend: () => backend,
    encryptStringAsync: vi.fn(async (value: string) =>
      Buffer.from(value).map((byte) => byte ^ 0x55),
    ),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({
      result: value.map((byte) => byte ^ 0x55).toString(),
      shouldReEncrypt: false,
    })),
  };
  return {
    store: createLicensingStore({ userDataPath, secureStorage, platform }),
    secureStorage,
    file: join(userDataPath, 'commercial-licence.v1'),
  };
}

describe('main-process protected credential storage', () => {
  it('round trips via OS encryption and never leaves a plaintext bearer on disk', async () => {
    const h = await storage();
    const value: LicenceRecord = {
      schemaVersion: 1,
      lastSeenAt: 10,
      credential: {
        entitlement: { keyId: 'test', payload: 'payload', signature: 'signature' },
        activationToken: 'a'.repeat(43),
      },
    };
    expect(await h.store.read()).toBeNull();
    await h.store.write(value);
    expect((await readFile(h.file)).toString()).not.toContain('a'.repeat(43));
    expect(await h.store.read()).toEqual(value);
    expect(h.secureStorage.encryptStringAsync).toHaveBeenCalledOnce();
  });
  it.each(['basic_text', 'unknown'])(
    'refuses the Linux %s backend instead of storing weakly protected secrets',
    async (backend) => {
      const h = await storage('linux', backend);
      await expect(h.store.write({ schemaVersion: 1, lastSeenAt: 10 })).rejects.toThrow(
        'Secure operating-system',
      );
      expect(h.secureStorage.encryptStringAsync).not.toHaveBeenCalled();
      await expect(readFile(h.file)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
  it('bounds stored data before decrypting and fails closed on corrupt encrypted data', async () => {
    const h = await storage();
    await writeFile(h.file, Buffer.alloc(131_073));
    await expect(h.store.read()).rejects.toBeInstanceOf(LicenceStoreUnreadableError);
    expect(h.secureStorage.decryptStringAsync).not.toHaveBeenCalled();
    await writeFile(h.file, Buffer.from('corrupt'));
    await expect(h.store.read()).rejects.toBeInstanceOf(LicenceStoreUnreadableError);
  });
  it('reports a record the OS key can no longer decrypt as unreadable, and resets it', async () => {
    const h = await storage();
    await h.store.write({ schemaVersion: 1, lastSeenAt: 10 });
    h.secureStorage.decryptStringAsync.mockRejectedValueOnce(new Error('key changed'));
    await expect(h.store.read()).rejects.toBeInstanceOf(LicenceStoreUnreadableError);
    await h.store.reset();
    await expect(readFile(h.file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await h.store.read()).toBeNull();
    await h.store.reset();
  });
  it('keeps a saved licence key only when it is a printable bounded key', async () => {
    const h = await storage();
    await h.store.write({ schemaVersion: 1, lastSeenAt: 10, licenseKey: 'KD1.license.secret' });
    expect((await h.store.read())?.licenseKey).toBe('KD1.license.secret');
    await expect(
      h.store.write({ schemaVersion: 1, lastSeenAt: 10, licenseKey: 'KD1 with space' }),
    ).rejects.toThrow();
    expect(validLicenceKey('KD1.license.secret')).toBe(true);
    expect(validLicenceKey('short')).toBe(false);
    expect(validLicenceKey('KD1.line\nbreak')).toBe(false);
  });
});

describe('stable private device binding', () => {
  it('hashes the installation identifier without returning it and normalises UUID case', async () => {
    const uuid = '12345678-abcd-4321-abcd-123456789012';
    const execute = vi.fn(async () => ` MachineGuid    REG_SZ    ${uuid}`);
    const first = await licensingDeviceId({ platform: 'win32', execute, read: vi.fn() });
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain(uuid);
    execute.mockResolvedValue(`MachineGuid REG_SZ ${uuid.toUpperCase()}`);
    expect(await licensingDeviceId({ platform: 'win32', execute, read: vi.fn() })).toBe(first);
  });
  it('does not silently generate a new device and reset trials when identification fails', async () => {
    await expect(
      licensingDeviceId({
        platform: 'linux',
        read: async () => '00000000000000000000000000000000',
        execute: vi.fn(),
      }),
    ).rejects.toThrow('stable device identity');
  });
});

function routes() {
  const runtime = createLicensingRuntime({
    config: { channel: 'free' },
    currentVersion: '1.0.0',
    store: { read: vi.fn(), write: vi.fn(), reset: vi.fn() },
    deviceId: vi.fn(),
    deviceName: 'test',
    fetch: vi.fn(),
  });
  const activate = vi.spyOn(runtime, 'activate');
  return {
    runtime,
    activate,
    handle: withLicensingRoutes(async () => new Response('asset'), runtime),
  };
}
function request(
  path = 'activate',
  headers: Record<string, string> = {},
  body: unknown = { licenseKey: 'licence-key' },
) {
  return new Request(`app://app/api/licensing/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-KerfDesk-Licensing': '1', ...headers },
    body: JSON.stringify(body),
  });
}

describe('licensing custom protocol capability boundary', () => {
  it('accepts only explicit operation inputs and never lets a renderer choose a device or server', async () => {
    const h = routes();
    expect((await h.handle(request())).status).toBe(200);
    expect(h.activate).toHaveBeenCalledExactlyOnceWith('licence-key');
    expect(
      (await h.handle(request('activate', {}, { licenseKey: 'licence-key', deviceId: 'forged' })))
        .status,
    ).toBe(400);
    expect((await h.handle(request('trial', {}, { url: 'https://evil.example' }))).status).toBe(
      400,
    );
    expect(h.activate).toHaveBeenCalledTimes(1);
  });
  it('routes the recovery actions and no longer offers a launch gate', async () => {
    const h = routes();
    const reset = vi.spyOn(h.runtime, 'resetStore');
    const discard = vi.spyOn(h.runtime, 'discardPayment');
    const handle = withLicensingRoutes(async () => new Response('asset'), h.runtime);
    expect((await handle(request('reset', {}, {}))).status).toBe(200);
    expect((await handle(request('discard-payment', {}, {}))).status).toBe(200);
    expect(reset).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledOnce();
    expect((await handle(request('launch', {}, {}))).status).toBe(404);
  });
  it.each([
    { Origin: 'https://evil.example' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'X-KerfDesk-Licensing': '' },
  ])('rejects foreign or implicit requests: %j', async (headers) => {
    const h = routes();
    expect((await h.handle(request('activate', headers))).status).toBe(404);
    expect(h.activate).not.toHaveBeenCalled();
  });
  it('rejects oversized bodies, query variants and wrong methods', async () => {
    const h = routes();
    expect((await h.handle(request('activate', {}, { licenseKey: 'x'.repeat(3000) }))).status).toBe(
      400,
    );
    expect((await h.handle(request('activate?extra=1'))).status).toBe(404);
    expect(
      (
        await h.handle(
          new Request('app://app/api/licensing/activate', {
            headers: { 'X-KerfDesk-Licensing': '1' },
          }),
        )
      ).status,
    ).toBe(404);
  });
  it('cancels an oversized network response while streaming and refuses redirects', async () => {
    const cancel = vi.fn();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe('error');
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(65_537));
          },
          cancel,
        }),
      );
    });
    await expect(
      licensingRequest('https://licensing.example', fetch)('/v1/trials/start', {}),
    ).rejects.toThrow('too large');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
