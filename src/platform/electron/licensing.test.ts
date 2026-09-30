import { describe, expect, it, vi } from 'vitest';
import {
  createDesktopLicenceAdapter,
  parseCommercialUpdateStatus,
  parseEarlyUpdates,
} from './licensing';

describe('desktop early updates setting (ADR-541)', () => {
  it('reads and changes the setting through the licensing route', async () => {
    const fetchLicence = vi.fn(async (_input: string, init: RequestInit) =>
      Response.json({ available: true, enabled: init.method === 'POST' }),
    );
    const adapter = createDesktopLicenceAdapter(fetchLicence);
    expect(await adapter.earlyUpdates()).toEqual({ available: true, enabled: false });
    expect(await adapter.setEarlyUpdates(true)).toEqual({ available: true, enabled: true });
    const [read, write] = fetchLicence.mock.calls;
    expect(read?.[0]).toBe('./api/licensing/early-updates');
    expect(read?.[1].method).toBe('GET');
    expect(write?.[0]).toBe('./api/licensing/early-updates');
    expect(write?.[1]).toMatchObject({
      method: 'POST',
      body: '{"enabled":true}',
      headers: { 'X-KerfDesk-Licensing': '1', 'Content-Type': 'application/json' },
    });
  });

  it('refuses a malformed answer or an unavailable route', async () => {
    for (const value of [
      null,
      { available: 'yes', enabled: false },
      { available: true },
      { available: false, enabled: true },
    ])
      expect(() => parseEarlyUpdates(value)).toThrow('Invalid update setting');
    expect(parseEarlyUpdates({ available: true, enabled: true, extra: 1 })).toEqual({
      available: true,
      enabled: true,
    });
    const missing = createDesktopLicenceAdapter(
      async () => new Response('Not Found', { status: 404 }),
    );
    await expect(missing.earlyUpdates()).rejects.toThrow('unavailable');
  });
});

describe('desktop update status (ADR-547)', () => {
  const ready = {
    state: 'ready',
    currentVersion: '2026.40.0',
    version: '2026.41.0',
    checkedAt: 1_790_000_000_000,
  };

  it('reads the status and starts a check through the licensing routes', async () => {
    const fetchLicence = vi.fn(async (_input: string, init: RequestInit) =>
      Response.json(init.method === 'POST' ? { ...ready, state: 'checking' } : ready),
    );
    const adapter = createDesktopLicenceAdapter(fetchLicence);
    expect(await adapter.updateStatus()).toEqual(ready);
    expect(await adapter.checkForUpdates()).toMatchObject({ state: 'checking' });
    const [read, check] = fetchLicence.mock.calls;
    expect(read?.[0]).toBe('./api/licensing/update-status');
    expect(read?.[1].method).toBe('GET');
    expect(check?.[0]).toBe('./api/licensing/check-updates');
    expect(check?.[1]).toMatchObject({ method: 'POST', body: '{}' });
  });

  it('refuses a malformed status and keeps only the known fields', () => {
    for (const value of [
      null,
      { ...ready, state: 'installing' },
      { ...ready, currentVersion: 7 },
      { ...ready, version: '2026.41' },
      { ...ready, version: '<b>2026.41.0</b>' },
      { ...ready, checkedAt: 1.5 },
    ])
      expect(() => parseCommercialUpdateStatus(value)).toThrow('Invalid update status');
    expect(parseCommercialUpdateStatus({ ...ready, extra: true })).toEqual(ready);
  });

  it('sends empty explicit manual actions and only accepts consistent manual states', async () => {
    const manual = { ...ready, mode: 'manual', installOnQuit: false };
    const fetchLicence = vi.fn(async () => Response.json(manual));
    const adapter = createDesktopLicenceAdapter(fetchLicence);
    expect(await adapter.downloadUpdate?.()).toEqual(manual);
    expect(await adapter.installUpdateOnQuit?.()).toEqual(manual);
    expect(fetchLicence.mock.calls).toEqual(
      ['download-update', 'install-update-on-quit'].map((action) => [
        `./api/licensing/${action}`,
        expect.objectContaining({
          method: 'POST',
          body: '{}',
          cache: 'no-store',
          headers: expect.objectContaining({
            'X-KerfDesk-Licensing': '1',
            'Content-Type': 'application/json',
          }),
        }),
      ]),
    );
    expect(parseCommercialUpdateStatus({ ...manual, state: 'available' })).toMatchObject({
      state: 'available',
    });
    expect(parseCommercialUpdateStatus({ ...manual, installOnQuit: true })).toMatchObject({
      installOnQuit: true,
    });
    for (const value of [
      { ...ready, mode: 'automatic' },
      { ...ready, state: 'available' },
      { ...ready, installOnQuit: true },
      { ...manual, installOnQuit: 'true' },
      { ...manual, state: 'available', installOnQuit: true },
      { ...manual, state: 'downloading', installOnQuit: true },
      { ...manual, version: null },
      { ...manual, state: 'available', version: null },
    ])
      expect(() => parseCommercialUpdateStatus(value)).toThrow('Invalid update status');
  });
});
