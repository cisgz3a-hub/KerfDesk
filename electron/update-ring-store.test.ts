import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withLicensingRoutes } from './licensing-routes';
import { createLicensingRuntime } from './licensing-runtime';
import {
  UPDATE_RING_FILE,
  createUpdateRingStore,
  earlyUpdateSetting,
  parseUpdateRing,
  type EarlyUpdates,
} from './update-ring-store';

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) {
    if (dirname(path) !== tmpdir()) throw new Error('Unexpected test directory');
    await rm(path, { recursive: true, force: true });
  }
});
async function userData(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'kerfdesk-update-ring-test-'));
  temporary.push(path);
  return path;
}

describe('the saved update ring (ADR-541)', () => {
  it('reads stable until the owner asks for beta, and saves the choice atomically', async () => {
    const path = await userData();
    const store = createUpdateRingStore(join(path, 'nested'));
    expect(await store.read()).toBe('stable');
    await store.write('beta');
    expect(await store.read()).toBe('beta');
    expect(await readFile(join(path, 'nested', UPDATE_RING_FILE), 'utf8')).toBe(
      '{"schemaVersion":1,"ring":"beta"}\n',
    );
    await store.write('stable');
    expect(await store.read()).toBe('stable');
    expect(await readdir(join(path, 'nested'))).toEqual([UPDATE_RING_FILE]);
    await expect(store.write('alpha' as 'beta')).rejects.toThrow('Unknown update ring');
  });

  it('falls back to stable for any damaged, foreign or oversized file', async () => {
    for (const text of [
      '',
      'not json',
      '{"schemaVersion":2,"ring":"beta"}',
      '{"schemaVersion":1,"ring":"alpha"}',
      '{"schemaVersion":1,"ring":"beta","extra":true}',
      '["beta"]',
      'null',
    ])
      expect(parseUpdateRing(text), text).toBe('stable');
    const path = await userData();
    const store = createUpdateRingStore(path);
    const file = join(path, UPDATE_RING_FILE);
    await writeFile(file, `{"schemaVersion":1,"ring":"beta"}${' '.repeat(1024)}`);
    expect(await store.read()).toBe('stable');
    await writeFile(file, Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
    expect(await store.read()).toBe('stable');
    await rm(file);
    await writeFile(join(path, UPDATE_RING_FILE), '{"schemaVersion":1,"ring":"beta"}');
    expect(await store.read()).toBe('beta');
  });

  it('offers the setting only in builds that take commercial updates', async () => {
    const path = await userData();
    const rings = createUpdateRingStore(path);
    const commercial = earlyUpdateSetting(true, rings);
    expect(await commercial.read()).toEqual({ available: true, enabled: false });
    expect(await commercial.write(true)).toEqual({ available: true, enabled: true });
    const free = earlyUpdateSetting(false, rings);
    expect(await free.read()).toEqual({ available: false, enabled: false });
    await expect(free.write(false)).rejects.toThrow('unavailable');
    expect(await rings.read()).toBe('beta');
  });
});

function routes(earlyUpdates?: EarlyUpdates) {
  const runtime = createLicensingRuntime({
    config: { channel: 'free' },
    currentVersion: '1.0.0',
    store: { read: vi.fn(), write: vi.fn(), reset: vi.fn() },
    deviceId: vi.fn(),
    deviceName: 'test',
    fetch: vi.fn(),
  });
  return withLicensingRoutes(async () => new Response('asset'), runtime, earlyUpdates);
}
function request(body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request('app://app/api/licensing/early-updates', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-KerfDesk-Licensing': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('the early updates licensing route', () => {
  it('reads and changes the setting through exactly one boolean', async () => {
    const path = await userData();
    const handle = routes(earlyUpdateSetting(true, createUpdateRingStore(path)));
    expect(await (await handle(request())).json()).toEqual({ available: true, enabled: false });
    const changed = await handle(request({ enabled: true }));
    expect(changed.status).toBe(200);
    expect(changed.headers.get('Cache-Control')).toBe('no-store');
    expect(await changed.json()).toEqual({ available: true, enabled: true });
    expect(await createUpdateRingStore(path).read()).toBe('beta');
    for (const body of [{}, { enabled: 'yes' }, { enabled: true, ring: 'alpha' }, ['beta']])
      expect((await handle(request(body))).status, JSON.stringify(body)).toBe(400);
    expect(
      (await handle(request({ enabled: false }, { 'Content-Type': 'text/plain' }))).status,
    ).toBe(404);
    expect(
      (await handle(request({ enabled: false }, { Origin: 'https://evil.example' }))).status,
    ).toBe(404);
    expect(await createUpdateRingStore(path).read()).toBe('beta');
  });

  it('is missing where the build has no commercial updates, and reports failed saves', async () => {
    const free = routes(earlyUpdateSetting(false, createUpdateRingStore(await userData())));
    expect(await (await free(request())).json()).toEqual({ available: false, enabled: false });
    expect((await free(request({ enabled: true }))).status).toBe(404);
    expect((await routes()(request())).status).toBe(404);
    const failing = routes({
      read: async () => ({ available: true, enabled: false }),
      write: async () => {
        throw new Error('disk full');
      },
    });
    const failed = await failing(request({ enabled: true }));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: 'unavailable' });
  });
});
