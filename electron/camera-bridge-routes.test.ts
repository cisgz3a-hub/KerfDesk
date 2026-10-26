// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { CameraBridgeStatus } from './camera-bridge-lifecycle';
import { withCameraBridgeRoutes } from './camera-bridge-routes';

const keys = { proofKey: 'proof-key', clientToken: 'client-token' };
const URL_ = 'app://app/api/camera-bridge/connection';
const TRUSTED = { 'X-KerfDesk-Camera-Bridge': '1', 'Sec-Fetch-Site': 'same-origin' };

function routes(status: CameraBridgeStatus) {
  const fallback = vi.fn(async () => new Response('fallback'));
  const statusOf = vi.fn(async () => status);
  const handler = withCameraBridgeRoutes(fallback, {
    origin: 'http://127.0.0.1:51731',
    keys,
    status: statusOf,
  });
  return { handler, fallback, statusOf };
}

describe('the camera bridge connection route (ADR-141 Amendment 2)', () => {
  it('gives KerfDesk’s window the bridge and this launch’s keys while it runs', async () => {
    const { handler } = routes({ kind: 'running' });
    const response = await handler(new Request(URL_, { headers: TRUSTED }));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      kind: 'running',
      origin: 'http://127.0.0.1:51731',
      proofKey: 'proof-key',
      clientToken: 'client-token',
    });
  });

  it('says why the bridge is not running, without keys', async () => {
    const reason = 'Another program on this computer is already using port 51731.';
    const failed = await routes({ kind: 'failed', reason }).handler(
      new Request(URL_, { headers: TRUSTED }),
    );
    expect(await failed.json()).toEqual({ kind: 'unavailable', reason });
    const stopped = await routes({ kind: 'stopped' }).handler(
      new Request(URL_, { headers: TRUSTED }),
    );
    const body = (await stopped.json()) as Record<string, unknown>;
    expect(body).toEqual({ kind: 'unavailable', reason: expect.stringContaining('not running') });
    expect(JSON.stringify(body)).not.toContain('proof-key');
  });

  it('answers no other page, method or request, and leaves other routes alone', async () => {
    const { handler, fallback, statusOf } = routes({ kind: 'running' });
    for (const request of [
      new Request(URL_),
      new Request(URL_, { headers: { ...TRUSTED, Origin: 'http://localhost:5173' } }),
      new Request(URL_, { headers: { ...TRUSTED, 'Sec-Fetch-Site': 'cross-site' } }),
      new Request(URL_, { method: 'POST', headers: TRUSTED }),
      new Request(`${URL_}?x=1`, { headers: TRUSTED }),
      new Request('app://app/api/camera-bridge/keys', { headers: TRUSTED }),
    ]) {
      const response = await handler(request);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('client-token');
    }
    expect(statusOf).not.toHaveBeenCalled();
    expect(await (await handler(new Request('app://app/index.html'))).text()).toBe('fallback');
    expect(fallback).toHaveBeenCalledOnce();
  });
});
