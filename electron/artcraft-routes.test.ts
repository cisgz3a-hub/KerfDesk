// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ARTCRAFT_ROUTE, withArtcraftRoutes } from './artcraft-routes';
import type { ArtcraftRuntime } from './artcraft-types';

function harness() {
  const runtime: ArtcraftRuntime = {
    status: vi.fn().mockResolvedValue({ available: true }),
    open: vi.fn().mockResolvedValue({ id: 'opened' }),
    snapshot: vi.fn().mockResolvedValue({ id: 'snapshot' }),
    resume: vi.fn().mockResolvedValue({ id: 'resumed' }),
  };
  const fallback = vi.fn().mockResolvedValue(new Response('fallback'));
  return { runtime, fallback, route: withArtcraftRoutes(fallback, runtime) };
}
function post(body: unknown, extra: Record<string, string> = {}) {
  return new Request(`app://app${ARTCRAFT_ROUTE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-KerfDesk-Studio': '1', ...extra },
    body: JSON.stringify(body),
  });
}

describe('ArtCraft route authority and upload validation', () => {
  it.each([
    ['https://app', {}],
    ['app://other', {}],
    ['app://app', { Origin: 'https://evil.example' }],
    ['app://app', { 'Sec-Fetch-Site': 'cross-site' }],
    ['app://app', { 'X-KerfDesk-Studio': '0' }],
  ] as const)('rejects untrusted calls through %s', async (base, extra) => {
    const { route, runtime } = harness();
    const response = await route(
      new Request(`${base}${ARTCRAFT_ROUTE}`, { headers: { 'X-KerfDesk-Studio': '1', ...extra } }),
    );
    expect(response.status).toBe(404);
    expect(runtime.status).not.toHaveBeenCalled();
  });
  it('accepts a same-origin desktop request and preserves the validated source', async () => {
    const { route, runtime } = harness();
    const source = { name: 'drawing.svg', mediaType: 'image/svg+xml', dataBase64: 'PHN2Zy8+' };
    const response = await route(
      post(
        { action: 'open', editor: 'vector', widthMm: 100, source },
        { Origin: 'app://app', 'Sec-Fetch-Site': 'same-origin' },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(runtime.open).toHaveBeenCalledWith({ editor: 'vector', widthMm: 100, source });
  });
  it.each([
    { editor: 'unknown' },
    { editor: 'photo', widthMm: -1 },
    { editor: 'photo', heightMm: 2001 },
    { editor: 'photo', source: { name: 'x', mediaType: 'image/png', dataBase64: '@@' } },
    {
      editor: 'photo',
      source: { name: 'x'.repeat(241), mediaType: 'image/png', dataBase64: 'YQ==' },
    },
  ])('rejects invalid input before launching an editor: %j', async (input) => {
    const { route, runtime } = harness();
    expect((await route(post({ action: 'open', ...input }))).status).toBe(400);
    expect(runtime.open).not.toHaveBeenCalled();
  });
  it('keeps unrelated routes on the existing handler', async () => {
    const { route, fallback } = harness();
    expect(await (await route(new Request('app://app/other'))).text()).toBe('fallback');
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
