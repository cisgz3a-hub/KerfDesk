import { describe, expect, it, vi } from 'vitest';
import { createDesktopPreviewUpdateAdapter } from './preview-updates';

describe('desktop Preview update adapter', () => {
  it('accepts only a strict validated availability response', async () => {
    const fetchUpdate = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ kind: 'available', version: '1.2.3-preview.4' })),
      ),
    );
    const adapter = createDesktopPreviewUpdateAdapter(fetchUpdate);
    await expect(adapter.checkForUpdate()).resolves.toEqual({
      kind: 'available',
      version: '1.2.3-preview.4',
    });
    expect(adapter.downloadPageUrl('1.2.3-preview.4')).toBe(
      'https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v1.2.3-preview.4',
    );
  });

  it.each([
    { kind: 'available', version: '1.2.3' },
    { kind: 'available', version: '1.2.3-preview.04' },
    { kind: 'available', version: 4 },
    { kind: 'unexpected', version: '1.2.3-preview.4' },
    null,
  ])('fails closed for malformed renderer data %#', async (payload) => {
    const adapter = createDesktopPreviewUpdateAdapter(() =>
      Promise.resolve(new Response(JSON.stringify(payload))),
    );
    await expect(adapter.checkForUpdate()).resolves.toEqual({ kind: 'none' });
  });

  it('uses a same-origin no-cache request and coalesces repeated checks', async () => {
    const fetchUpdate = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ kind: 'none' }))),
    );
    const adapter = createDesktopPreviewUpdateAdapter(fetchUpdate);
    await Promise.all([adapter.checkForUpdate(), adapter.checkForUpdate()]);
    expect(fetchUpdate).toHaveBeenCalledOnce();
    expect(fetchUpdate).toHaveBeenCalledWith('./api/desktop-preview-update', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  });

  it('keeps offline and HTTP failures silent', async () => {
    const offline = createDesktopPreviewUpdateAdapter(() => Promise.reject(new Error('offline')));
    const unavailable = createDesktopPreviewUpdateAdapter(() =>
      Promise.resolve(new Response('', { status: 503 })),
    );
    await expect(offline.checkForUpdate()).resolves.toEqual({ kind: 'none' });
    await expect(unavailable.checkForUpdate()).resolves.toEqual({ kind: 'none' });
  });
});
