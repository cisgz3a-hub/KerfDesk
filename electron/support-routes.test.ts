// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { withSupportRoutes } from './support-routes';

function routes() {
  const recent = vi.fn(() => '2026-09-29T07:00:00.000Z INFO  [app] KerfDesk 0.9.1 started.\n');
  const fallback = vi.fn(async () => new Response('asset'));
  return { recent, fallback, handle: withSupportRoutes(fallback, { recent }) };
}

function request(
  url = 'app://app/api/support/log',
  headers: Record<string, string> = {},
  method = 'GET',
): Request {
  return new Request(url, { method, headers: { 'X-KerfDesk-Support': '1', ...headers } });
}

describe('support log route', () => {
  it("gives the app's own window the newest part of the log", async () => {
    const h = routes();
    const response = await h.handle(
      request(undefined, { Origin: 'app://app', 'Sec-Fetch-Site': 'same-origin' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toContain('KerfDesk 0.9.1 started.');
  });

  it('leaves every other app:// path to the next handler', async () => {
    const h = routes();
    expect(await (await h.handle(request('app://app/index.html'))).text()).toBe('asset');
    expect(h.fallback).toHaveBeenCalledOnce();
    expect(h.recent).not.toHaveBeenCalled();
  });

  it.each([
    { Origin: 'https://evil.example' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'X-KerfDesk-Support': '' },
  ])('refuses a foreign or implicit request: %j', async (headers) => {
    const h = routes();
    expect((await h.handle(request(undefined, headers))).status).toBe(404);
    expect(h.recent).not.toHaveBeenCalled();
  });

  it.each([
    ['another host', 'app://other/api/support/log', 'GET'],
    ['a query', 'app://app/api/support/log?all=1', 'GET'],
    ['another support path', 'app://app/api/support/upload', 'GET'],
    ['a write', 'app://app/api/support/log', 'POST'],
  ])('refuses %s', async (_name, url, method) => {
    const h = routes();
    expect((await h.handle(request(url, {}, method))).status).toBe(404);
    expect(h.recent).not.toHaveBeenCalled();
    expect(h.fallback).not.toHaveBeenCalled();
  });
});
