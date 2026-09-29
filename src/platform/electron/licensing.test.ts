import { describe, expect, it, vi } from 'vitest';
import { createDesktopLicenceAdapter, parseEarlyUpdates } from './licensing';

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
