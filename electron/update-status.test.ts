import { describe, expect, it, vi } from 'vitest';
import type { UpdateCheckOutcome } from './commercial-update';
import { withLicensingRoutes } from './licensing-routes';
import { createLicensingRuntime } from './licensing-runtime';
import { createDesktopUpdates, type DesktopUpdates } from './update-status';

const NOW = Date.parse('2026-09-29T08:00:00.000Z');

function deferred() {
  let resolve!: (outcome: UpdateCheckOutcome) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<UpdateCheckOutcome>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function updates(offered = true) {
  const pending = deferred();
  let downloading: ((version: string) => void) | null = null;
  const run = vi.fn((onDownloading: (version: string) => void) => {
    downloading = onDownloading;
    return pending.promise;
  });
  const subject = createDesktopUpdates({
    offered,
    currentVersion: '2026.40.0',
    run,
    now: () => NOW,
  });
  return { subject, run, pending, downloading: (version: string) => downloading?.(version) };
}

describe('desktop update status (ADR-547)', () => {
  it('never checks in a build without commercial updates', () => {
    const { subject, run } = updates(false);
    expect(subject.check()).toEqual({
      state: 'unavailable',
      currentVersion: '2026.40.0',
      version: null,
      checkedAt: null,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('reports checking, downloading and ready, and keeps a ready update', async () => {
    const { subject, run, pending, downloading } = updates();
    expect(subject.status().state).toBe('idle');
    expect(subject.check().state).toBe('checking');
    expect(subject.check().state).toBe('checking');
    downloading('2026.41.0');
    expect(subject.status()).toMatchObject({ state: 'downloading', version: '2026.41.0' });
    pending.resolve({ kind: 'ready', version: '2026.41.0' });
    await subject.settled();
    expect(subject.status()).toEqual({
      state: 'ready',
      currentVersion: '2026.40.0',
      version: '2026.41.0',
      checkedAt: NOW,
    });
    // A downloaded update installs when KerfDesk closes; nothing downloads twice.
    expect(subject.check().state).toBe('ready');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ kind: 'up-to-date' } as const, 'up-to-date', null],
    [{ kind: 'not-covered', version: '2026.44.0' } as const, 'not-covered', '2026.44.0'],
    [{ kind: 'not-installed', version: '2026.41.0' } as const, 'failed', '2026.41.0'],
  ])('maps %o to %s and lets the owner check again', async (outcome, state, version) => {
    const { subject, run, pending } = updates();
    subject.check();
    pending.resolve(outcome);
    await subject.settled();
    expect(subject.status()).toMatchObject({ state, version, checkedAt: NOW });
    subject.check();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports a failed check, keeping the version it was downloading', async () => {
    const { subject, pending, downloading } = updates();
    subject.check();
    downloading('2026.41.0');
    pending.reject(new Error('offline'));
    await subject.settled();
    expect(subject.status()).toMatchObject({
      state: 'failed',
      version: '2026.41.0',
      checkedAt: NOW,
    });
  });
});

function routes(subject?: DesktopUpdates) {
  const runtime = createLicensingRuntime({
    config: { channel: 'free' },
    currentVersion: '1.0.0',
    store: { read: vi.fn(), write: vi.fn(), reset: vi.fn() },
    deviceId: vi.fn(),
    deviceName: 'test',
    fetch: vi.fn(),
  });
  return withLicensingRoutes(async () => new Response('asset'), runtime, undefined, subject);
}
function request(
  action: string,
  body?: unknown,
  headers: Record<string, string> = {},
  method = body === undefined ? 'GET' : 'POST',
): Request {
  return new Request(`app://app/api/licensing/${action}`, {
    method,
    headers: {
      'X-KerfDesk-Licensing': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('the update status licensing routes', () => {
  it('reads the status and starts a check that answers at once', async () => {
    const { subject, run } = updates();
    const handle = routes(subject);
    expect(await (await handle(request('update-status'))).json()).toMatchObject({
      state: 'idle',
    });
    const started = await handle(request('check-updates', {}));
    expect(started.status).toBe(200);
    expect(started.headers.get('Cache-Control')).toBe('no-store');
    expect(await started.json()).toMatchObject({ state: 'checking' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses anything but an empty JSON check from KerfDesk itself', async () => {
    const { subject, run } = updates();
    const handle = routes(subject);
    expect((await handle(request('check-updates', { force: true }))).status).toBe(400);
    expect((await handle(request('check-updates', []))).status).toBe(400);
    expect((await handle(request('check-updates'))).status).toBe(404);
    expect((await handle(request('update-status', {}))).status).toBe(404);
    expect(
      (await handle(request('check-updates', {}, { 'Content-Type': 'text/plain' }))).status,
    ).toBe(404);
    expect(
      (await handle(request('check-updates', {}, { Origin: 'https://evil.example' }))).status,
    ).toBe(404);
    expect(
      (await handle(request('check-updates', {}, { 'X-KerfDesk-Licensing': '0' }))).status,
    ).toBe(404);
    expect(run).not.toHaveBeenCalled();
    expect((await routes()(request('update-status'))).status).toBe(404);
  });
});
