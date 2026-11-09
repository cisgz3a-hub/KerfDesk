import { describe, expect, it, vi } from 'vitest';
import { createDesktopCameraAddressVault } from './desktop-camera-address-vault';

const ADDRESS = 'rtsp://192.168.1.10/user=viewer&password=stand-in-secret-0';

describe('the desktop window’s remembered camera address (ADR-692)', () => {
  it('asks main over app://app with the route’s own header', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ saved: true })
        : Response.json({ address: ADDRESS }),
    );
    const vault = createDesktopCameraAddressVault(fetcher as typeof fetch);
    expect(await vault.write(ADDRESS)).toBe(true);
    expect(await vault.read()).toBe(ADDRESS);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('app://app/api/camera-address/rtsp');
    expect(new Headers(init?.headers).get('X-KerfDesk-Camera-Address')).toBe('1');
    expect(JSON.parse(String(init?.body))).toEqual({ address: ADDRESS });
  });

  it('reads every failure as nothing kept', async () => {
    for (const fetcher of [
      vi.fn(async () => new Response('', { status: 404 })),
      vi.fn(async () => Response.json({ address: 42, saved: 'yes' })),
      vi.fn(async () => {
        throw new Error('main is gone');
      }),
    ]) {
      const vault = createDesktopCameraAddressVault(fetcher as typeof fetch);
      expect(await vault.read()).toBeNull();
      expect(await vault.write(ADDRESS)).toBe(false);
    }
  });
});
