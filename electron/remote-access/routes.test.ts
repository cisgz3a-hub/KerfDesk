// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopStartup } from '../desktop-startup.js';
import { createRemoteAccessRuntime } from './runtime.js';
import { createRemoteRendererQueue } from './renderer-queue.js';
import { withRemoteAccessRoutes } from './routes.js';

function fixture() {
  const queue = createRemoteRendererQueue();
  const read = vi.fn(async () => null);
  const runtime = createRemoteAccessRuntime(
    {
      read,
      write: vi.fn(async () => undefined),
      create: () => ({
        schemaVersion: 1,
        deviceId: randomUUID(),
        ownerSecret: 'A'.repeat(43),
        enabled: false,
        revokeOnConnect: false,
        pendingRevocations: [],
      }),
    },
    queue,
  );
  const fallback = vi.fn(async () => new Response('ordinary workspace'));
  return {
    queue,
    runtime,
    read,
    fallback,
    handle: withRemoteAccessRoutes(fallback, runtime, queue),
  };
}
const request = (
  action: string,
  value: unknown = {},
  options: RequestInit = {},
  prefix = 'app://app',
) =>
  new Request(`${prefix}/api/remote/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KerfDesk-Remote': '1',
      Origin: 'app://app',
    },
    body: JSON.stringify(value),
    ...options,
  });
async function attach(f: ReturnType<typeof fixture>): Promise<string> {
  const response = await f.handle(request('attach'));
  expect(response.status).toBe(200);
  const value = (await response.json()) as { sessionId: string };
  return value.sessionId;
}

describe('private native remote routes', () => {
  it.each([
    ['missing header', {}, 'app://app', 'attach'],
    [
      'foreign origin',
      { 'X-KerfDesk-Remote': '1', Origin: 'https://evil.example' },
      'app://app',
      'attach',
    ],
    [
      'cross-site',
      { 'X-KerfDesk-Remote': '1', 'Sec-Fetch-Site': 'cross-site' },
      'app://app',
      'attach',
    ],
    ['HTTPS', { 'X-KerfDesk-Remote': '1' }, 'https://app', 'attach'],
    ['other app host', { 'X-KerfDesk-Remote': '1' }, 'app://other', 'attach'],
    ['query', { 'X-KerfDesk-Remote': '1' }, 'app://app', 'attach?enabled=true'],
  ] as const)('rejects %s before reading credentials', async (_label, headers, prefix, action) => {
    const f = fixture();
    expect((await f.handle(request(action, {}, { headers }, prefix))).status).toBe(404);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.queue.ready()).toBe(false);
    f.runtime.closed();
  });

  it('cannot construct a credential-bearing native Request', () => {
    expect(() => request('attach', {}, {}, 'app://owner@app')).toThrow('includes credentials');
  });

  it('holds remote initialization until the ordinary workspace acceptance gates have opened', async () => {
    const f = fixture();
    const startup = createDesktopStartup(vi.fn());
    const handle = startup.routes(f.handle);
    expect((await handle(request('attach'))).status).toBe(503);
    expect(f.read).not.toHaveBeenCalled();
    const ready = new Request('app://app/api/desktop/workspace-ready', {
      method: 'POST',
      headers: { 'X-KerfDesk-Desktop': '1', Origin: 'app://app' },
    });
    expect((await handle(ready)).status).toBe(204);
    expect((await handle(request('attach'))).status).toBe(200);
    expect(f.read).toHaveBeenCalledOnce();
    f.runtime.closed();
    f.queue.detach();
  });

  it('invalidates old detach and completion ownership when a new renderer attaches', async () => {
    const f = fixture();
    const old = await attach(f);
    const pending = f.queue.request('get_workspace', {}, 'client', false).catch((e) => e);
    const delivered = f.queue.poll(old).requests[0]!;
    const current = await attach(f);
    expect(await pending).toMatchObject({ code: 'unavailable' });
    expect((await f.handle(request('detach', { sessionId: old }))).status).toBe(409);
    expect(
      (await f.handle(request('complete', { sessionId: old, id: delivered.id, result: {} })))
        .status,
    ).toBe(409);
    expect(f.queue.owns(current)).toBe(true);
    f.runtime.closed();
    f.queue.detach();
  });

  it('unwraps projected success and sanitizes renderer errors at the native boundary', async () => {
    const f = fixture();
    const sessionId = await attach(f);
    const success = f.queue.request('get_workspace', {}, 'client', false);
    const id = f.queue.poll(sessionId).requests[0]!.id;
    await f.handle(
      request('complete', {
        sessionId,
        id,
        result: { ok: true, revision: 'current', data: { revision: 'forged', mode: 'laser' } },
      }),
    );
    await expect(success).resolves.toEqual({ revision: 'current', mode: 'laser' });
    const failure = f.queue.request('update_operation', {}, 'client', true).catch((e) => e);
    const second = f.queue.poll(sessionId).requests[0]!.id;
    await f.handle(
      request('complete', {
        sessionId,
        id: second,
        result: { ok: false, error: { code: 'not_editable', message: 'secret native path' } },
      }),
    );
    const error = await failure;
    expect(error.code).toBe('unsupported_operation');
    expect(error.message).not.toContain('secret native path');
    f.runtime.closed();
    f.queue.detach();
  });

  it('bounds JSON bodies, requires exact fields and passes ordinary app requests through', async () => {
    const f = fixture();
    const sessionId = await attach(f);
    expect(
      (await f.handle(request('complete', { sessionId, payload: 'a'.repeat(280 * 1024) }))).status,
    ).toBe(400);
    expect((await f.handle(request('poll', { sessionId, extra: true }))).status).toBe(404);
    const response = await f.handle(new Request('app://app/index.html'));
    expect(await response.text()).toBe('ordinary workspace');
    expect(f.fallback).toHaveBeenCalledOnce();
    f.runtime.closed();
    f.queue.detach();
  });
});
