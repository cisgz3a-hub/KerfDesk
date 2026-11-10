// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withCameraAddressRoutes } from './camera-address-routes';
import { createCameraAddressStore } from './camera-address-store';

const SECRET = 'stand-in-secret-0';
const ADDRESS = `rtsp://192.168.1.10:554/user=viewer&password=${SECRET}&channel=1`;
const URL_ = 'app://app/api/camera-address/rtsp';
const PHONE_URL = 'app://app/api/camera-address/phone';
const TRUSTED = { 'X-KerfDesk-Camera-Address': '1', 'Sec-Fetch-Site': 'same-origin' };

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

/** `tag` is the key provider's ciphertext prefix: v11 a Secret Service, v10 the fallback key. */
async function setup(platform = 'win32', tag = 'v11', available = true) {
  const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-camera-address-test-'));
  directories.push(directory);
  const secureStorage = {
    isAsyncEncryptionAvailable: vi.fn(async () => available),
    encryptStringAsync: vi.fn(async (text: string) =>
      Buffer.from(tag + Buffer.from(text).toString('base64')),
    ),
    decryptStringAsync: vi.fn(async (bytes: Buffer) => ({
      result: Buffer.from(bytes.subarray(3).toString(), 'base64').toString(),
      shouldReEncrypt: false,
    })),
  };
  const store = createCameraAddressStore({ userDataPath: directory, platform, secureStorage });
  return { directory, secureStorage, store };
}

async function filesText(directory: string): Promise<string> {
  const names = await readdir(directory);
  const texts = await Promise.all(names.map((name) => readFile(join(directory, name), 'latin1')));
  return texts.join('\n');
}

describe('the remembered RTSP address in secure storage (ADR-692)', () => {
  it('is kept only encrypted, and comes back in full', async () => {
    const { directory, store } = await setup();
    expect(await store.write('rtsp', ADDRESS)).toBe(true);
    expect(await filesText(directory)).not.toContain(SECRET);
    expect(await store.read('rtsp')).toBe(ADDRESS);
    expect(await store.write('rtsp', null)).toBe(false);
    expect(await store.read('rtsp')).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('keeps nothing when the operating system offers no encryption', async () => {
    const { directory, store, secureStorage } = await setup('win32', 'v11', false);
    expect(await store.write('rtsp', ADDRESS)).toBe(false);
    expect(secureStorage.encryptStringAsync).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
    expect(await store.read('rtsp')).toBeNull();
  });

  it('keeps nothing on Linux under the fallback key that every computer shares', async () => {
    const { directory, store } = await setup('linux', 'v10');
    expect(await store.write('rtsp', ADDRESS)).toBe(false);
    expect(await readdir(directory)).toEqual([]);
  });

  it('keeps the RTSP and phone addresses apart, each only for its own scheme', async () => {
    const { directory, store } = await setup();
    const phone = `http://192.168.1.50:8080/${SECRET}/shot.jpg`;
    expect(await store.write('rtsp', ADDRESS)).toBe(true);
    expect(await store.write('phone', phone)).toBe(true);
    expect(await filesText(directory)).not.toContain(SECRET);
    expect(await store.read('rtsp')).toBe(ADDRESS);
    expect(await store.read('phone')).toBe(phone);
    await store.write('rtsp', null);
    expect(await store.read('rtsp')).toBeNull();
    expect(await store.read('phone')).toBe(phone);
  });

  it('reads a damaged file as nothing kept', async () => {
    const { store, secureStorage } = await setup();
    await store.write('rtsp', ADDRESS);
    secureStorage.decryptStringAsync.mockRejectedValueOnce(new Error('bad key'));
    expect(await store.read('rtsp')).toBeNull();
  });
});

describe('the app route for the remembered address', () => {
  async function routes() {
    const { store, directory } = await setup();
    const fallback = vi.fn(async () => new Response('fallback'));
    return { handler: withCameraAddressRoutes(fallback, store), fallback, directory };
  }
  const post = (body: unknown, headers: Record<string, string> = TRUSTED) =>
    new Request(URL_, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('keeps and returns the address for KerfDesk’s own window', async () => {
    const { handler } = await routes();
    expect(await (await handler(post({ address: ADDRESS }))).json()).toEqual({ saved: true });
    const read = await handler(new Request(URL_, { headers: TRUSTED }));
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(await read.json()).toEqual({ address: ADDRESS });
    expect(await (await handler(post({ address: null }))).json()).toEqual({ saved: false });
    expect(await (await handler(new Request(URL_, { headers: TRUSTED }))).json()).toEqual({
      address: null,
    });
  });

  it('answers nothing to a request that is not from KerfDesk’s own window', async () => {
    const { handler } = await routes();
    await handler(post({ address: ADDRESS }));
    for (const headers of [
      {},
      { 'X-KerfDesk-Camera-Address': '1', Origin: 'https://example.test' },
      { 'X-KerfDesk-Camera-Address': '1', 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const response = await handler(new Request(URL_, { headers }));
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(SECRET);
    }
    expect((await handler(new Request(`${URL_}?x=1`, { headers: TRUSTED }))).status).toBe(404);
  });

  it('answers the phone slot only with an http address', async () => {
    const { handler } = await routes();
    const phone = (address: unknown) =>
      new Request(PHONE_URL, {
        method: 'POST',
        headers: { ...TRUSTED, 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
    expect((await handler(phone(ADDRESS))).status).toBe(400);
    const ok = await handler(phone('http://192.168.1.50:8080/shot.jpg'));
    expect(await ok.json()).toEqual({ saved: true });
    const other = await handler(
      new Request('app://app/api/camera-address/other', { headers: TRUSTED }),
    );
    expect(other.status).toBe(404);
  });

  it('refuses an address that is not an RTSP address', async () => {
    const { handler, directory } = await routes();
    for (const address of [
      'http://192.168.1.10/',
      `rtsp://host/\n${SECRET}`,
      42,
      'x'.repeat(5000),
    ]) {
      expect((await handler(post({ address }))).status).toBe(400);
    }
    expect(await readdir(directory)).toEqual([]);
  });

  it('passes other app routes on', async () => {
    const { handler, fallback } = await routes();
    await handler(new Request('app://app/api/other', { headers: TRUSTED }));
    expect(fallback).toHaveBeenCalledOnce();
  });
});
