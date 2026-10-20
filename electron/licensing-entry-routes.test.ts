// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import { withLicensingRoutes, type LicenceEntry } from './licensing-routes';

function routes(entry: LicenceEntry = {}) {
  const runtime = createLicensingRuntime({
    config: { channel: 'free' },
    currentVersion: '1.0.0',
    store: { read: vi.fn(), write: vi.fn(), reset: vi.fn() },
    deviceId: vi.fn(),
    deviceName: 'test',
    fetch: vi.fn(),
  });
  return withLicensingRoutes(
    async () => new Response('asset'),
    runtime,
    undefined,
    undefined,
    undefined,
    entry,
  );
}

function request(action: string, init: RequestInit = {}) {
  return new Request(`app://app/api/licensing/${action}`, {
    headers: { 'X-KerfDesk-Licensing': '1' },
    ...init,
  });
}

describe('optional desktop licensing entry reads', () => {
  it.each([
    ['licence-link', { open: false, licenseKey: null }],
    ['project-seal-key', { key: null }],
  ] as const)('reports absent %s without a failed startup resource', async (action, expected) => {
    const response = await routes()(request(action));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual(expected);
  });

  it('still returns configured helpers and consumes the licence link once per read', async () => {
    const consume = vi.fn(async () => ({ open: true, licenseKey: 'example-key' }));
    const projectSealKey = vi.fn(async () => 'a'.repeat(43));
    const handle = routes({ licenceLink: { consume }, projectSealKey });
    expect(await (await handle(request('licence-link'))).json()).toEqual({
      open: true,
      licenseKey: 'example-key',
    });
    expect(await (await handle(request('project-seal-key'))).json()).toEqual({
      key: 'a'.repeat(43),
    });
    expect(consume).toHaveBeenCalledOnce();
    expect(projectSealKey).toHaveBeenCalledOnce();
  });

  it.each(['licence-link', 'project-seal-key'])(
    'retains trusted GET guards for %s with and without helpers',
    async (action) => {
      const consume = vi.fn();
      const projectSealKey = vi.fn();
      for (const entry of [{}, { licenceLink: { consume }, projectSealKey }]) {
        const handle = routes(entry);
        for (const invalid of [
          request(action, { method: 'POST' }),
          request(action, { headers: {} }),
          request(action, {
            headers: { 'X-KerfDesk-Licensing': '1', Origin: 'https://evil.example' },
          }),
          request(action, {
            headers: { 'X-KerfDesk-Licensing': '1', 'Sec-Fetch-Site': 'cross-site' },
          }),
          request(`${action}?extra=1`),
        ])
          expect((await handle(invalid)).status).toBe(404);
      }
      expect(consume).not.toHaveBeenCalled();
      expect(projectSealKey).not.toHaveBeenCalled();
    },
  );

  it('does not replace a genuine helper failure with an absent result', async () => {
    const handle = routes({
      licenceLink: {
        consume: vi.fn(async () => {
          throw new Error('failed');
        }),
      },
      projectSealKey: vi.fn(async () => {
        throw new Error('failed');
      }),
    });
    await expect(handle(request('licence-link'))).rejects.toThrow('failed');
    await expect(handle(request('project-seal-key'))).rejects.toThrow('failed');
  });
});
