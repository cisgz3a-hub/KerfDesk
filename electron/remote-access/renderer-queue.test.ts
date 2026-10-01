// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemoteRendererQueue } from './renderer-queue.js';
import { KerfDeskMcpError } from '../mcp/backend.js';

afterEach(() => vi.useRealTimers());

describe('native renderer queue ownership', () => {
  it('delivers one request at a time and rejects forged, duplicate or undelivered completions', async () => {
    const queue = createRemoteRendererQueue();
    const session = queue.attach();
    const first = queue.request('get_workspace', {}, 'client', false);
    const second = queue.request('get_machine', {}, 'client', false);
    const delivery = queue.poll(session).requests[0]!;
    expect(queue.poll(session).requests).toEqual([]);
    expect(queue.complete('wrong', delivery.id, {})).toBe(false);
    expect(queue.complete(session, 'unknown', {})).toBe(false);
    expect(queue.complete(session, delivery.id, { revision: 'r1' })).toBe(true);
    expect(queue.complete(session, delivery.id, {})).toBe(false);
    await expect(first).resolves.toEqual({ revision: 'r1' });
    const next = queue.poll(session).requests[0]!;
    expect(next.command).toBe('get_machine');
    queue.complete(session, next.id, { revision: 'r2' });
    await expect(second).resolves.toEqual({ revision: 'r2' });
    queue.detach();
  });

  it('cancels delivered work and delivers its replacement in the same poll', async () => {
    const queue = createRemoteRendererQueue();
    const session = queue.attach();
    const controller = new AbortController();
    const first = queue.request('add_text', {}, 'client', true, controller.signal).catch((e) => e);
    const previous = queue.poll(session).requests[0]!;
    const second = queue.request('get_workspace', {}, 'client', false);
    controller.abort();
    expect(await first).toMatchObject({ code: 'cancelled' });
    const poll = queue.poll(session);
    expect(poll.cancelled).toEqual([previous.id]);
    expect(poll.requests).toHaveLength(1);
    expect(queue.complete(session, previous.id, { revision: 'late' })).toBe(false);
    queue.complete(session, poll.requests[0]!.id, { revision: 'fresh' });
    await expect(second).resolves.toEqual({ revision: 'fresh' });
    queue.detach();
  });

  it('invalidates an old window and cancels all its pending work', async () => {
    const queue = createRemoteRendererQueue();
    const old = queue.attach();
    const pending = queue.request('get_workspace', {}, 'client', false).catch((e) => e);
    const delivered = queue.poll(old).requests[0]!;
    const current = queue.attach();
    expect(await pending).toMatchObject({ code: 'unavailable' });
    expect(current).not.toBe(old);
    expect(queue.owns(old)).toBe(false);
    expect(() => queue.poll(old)).toThrow(KerfDeskMcpError);
    expect(queue.complete(old, delivered.id, {})).toBe(false);
    expect(queue.poll(current)).toEqual({ requests: [], cancelled: [] });
    queue.detach();
  });

  it('bounds inflight work and times out work which never completes', async () => {
    vi.useFakeTimers();
    const queue = createRemoteRendererQueue();
    const session = queue.attach();
    const requests = Array.from({ length: 32 }, () =>
      queue.request('get_workspace', {}, 'client', false).catch((e) => e),
    );
    await expect(queue.request('get_workspace', {}, 'client', false)).rejects.toMatchObject({
      code: 'unavailable',
    });
    const delivered = queue.poll(session).requests[0]!;
    await vi.advanceTimersByTimeAsync(20_000);
    for (const result of await Promise.all(requests)) expect(result.code).toBe('cancelled');
    expect(queue.poll(session)).toEqual({ requests: [], cancelled: [delivered.id] });
    queue.detach();
  });

  it('does not queue an already cancelled request', async () => {
    const queue = createRemoteRendererQueue();
    const session = queue.attach();
    const signal = AbortSignal.abort();
    await expect(queue.request('get_workspace', {}, 'client', false, signal)).rejects.toMatchObject(
      {
        code: 'cancelled',
      },
    );
    expect(queue.poll(session).requests).toEqual([]);
    queue.detach();
  });
});
