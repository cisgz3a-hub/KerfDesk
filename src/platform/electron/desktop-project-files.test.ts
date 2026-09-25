import { describe, expect, it, vi } from 'vitest';
import type { ExternalFileOpenRequest, RecentFileAdapter, RecentFileRef } from '../types';
import {
  createDesktopProjectFiles,
  DESKTOP_PROJECT_OPEN_EVENT,
  sameDesktopPath,
} from './desktop-project-files';
import { parseDesktopOpenRequests, parseDesktopProbe } from './desktop-project-responses';

const TOKEN = 'a'.repeat(43);
const PATH_REF: RecentFileRef = { kind: 'desktop-path', path: 'D:\\Jobs\\Sign.lf2', token: TOKEN };

type Route = { readonly status?: number; readonly body?: unknown; readonly bytes?: string };

function routeFetch(routes: Record<string, Route | Error>) {
  return vi.fn(async (input: string) => {
    const route = routes[input.split('?')[0] ?? ''];
    if (route === undefined) return new Response('Not Found', { status: 404 });
    if (route instanceof Error) throw route;
    const init = { status: route.status ?? 200 };
    return route.bytes !== undefined
      ? new Response(route.bytes, init)
      : Response.json(route.body ?? {}, init);
  });
}

function handleAdapter(overrides: Partial<RecentFileAdapter> = {}): RecentFileAdapter {
  return {
    open: vi.fn(async () => ({ kind: 'denied' as const })),
    probe: vi.fn(async () => ({ kind: 'unknown' as const })),
    isSameFile: vi.fn(async () => false),
    ...overrides,
  };
}

function handleRef(name: string): RecentFileRef {
  return { kind: 'handle', handle: { kind: 'file', name } as unknown as FileSystemFileHandle };
}

describe('desktop Recent Projects paths', () => {
  it('reads an Explorer-opened project back through main with its token', async () => {
    const fetchRoute = routeFetch({ './api/desktop-project-file': { bytes: '{"v":7}' } });
    const files = createDesktopProjectFiles(undefined, { fetchRoute, events: new EventTarget() });

    const result = await files.recentFiles.open(PATH_REF);

    expect(fetchRoute.mock.calls[0]?.[0]).toBe(
      `./api/desktop-project-file?path=D%3A%5CJobs%5CSign.lf2&token=${TOKEN}`,
    );
    expect(result.kind).toBe('opened');
    if (result.kind !== 'opened') return;
    expect(result.file).toMatchObject({ name: 'Sign.lf2', size: 7, recentRef: PATH_REF });
  });

  it.each([
    [404, { kind: 'missing' }],
    [403, { kind: 'denied' }],
    [415, { kind: 'failed', message: 'it is not a KerfDesk or LightBurn project file.' }],
    [500, { kind: 'failed', message: 'KerfDesk could not read it.' }],
  ])('maps a %i answer to %j', async (status, expected) => {
    const fetchRoute = routeFetch({ './api/desktop-project-file': { status, body: {} } });
    const files = createDesktopProjectFiles(undefined, { fetchRoute, events: new EventTarget() });

    await expect(files.recentFiles.open(PATH_REF)).resolves.toEqual(expected);
  });

  it('passes picked-file handles to the handle adapter', async () => {
    const handles = handleAdapter();
    const files = createDesktopProjectFiles(handles, {
      fetchRoute: routeFetch({}),
      events: new EventTarget(),
    });
    const ref = handleRef('Sign.lf2');

    await files.recentFiles.open(ref);

    expect(handles.open).toHaveBeenCalledWith(ref);
  });

  it('probes a path without reading it and fails closed on odd answers', async () => {
    const present = routeFetch({
      './api/desktop-project-status': { body: { kind: 'present', size: 7, modifiedMs: 12.5 } },
    });
    const odd = routeFetch({ './api/desktop-project-status': { body: { kind: 'present' } } });
    const offline = routeFetch({ './api/desktop-project-status': new Error('offline') });
    const events = new EventTarget();

    for (const [fetchRoute, expected] of [
      [present, { kind: 'present', size: 7, modifiedMs: 12.5 }],
      [odd, { kind: 'unknown' }],
      [offline, { kind: 'unknown' }],
    ] as const) {
      const files = createDesktopProjectFiles(undefined, { fetchRoute, events });
      await expect(files.recentFiles.probe(PATH_REF)).resolves.toEqual(expected);
    }
  });
});

describe('desktop Recent Projects identity', () => {
  it('compares Windows paths the way the file system does', () => {
    expect(sameDesktopPath('D:\\Jobs\\Sign.lf2', 'd:/jobs/sign.LF2')).toBe(true);
    expect(sameDesktopPath('\\\\nas\\Jobs\\a.lf2', '\\\\NAS\\jobs\\A.lf2')).toBe(true);
    expect(sameDesktopPath('/Users/ann/Sign.lf2', '/Users/ann/sign.lf2')).toBe(false);
  });

  it('matches a picked handle and an Explorer path to one file by name, size and time', async () => {
    const handles = handleAdapter({
      probe: vi.fn(async () => ({ kind: 'present' as const, size: 7, modifiedMs: 1000 })),
    });
    const fetchRoute = routeFetch({
      './api/desktop-project-status': { body: { kind: 'present', size: 7, modifiedMs: 1000.4 } },
    });
    const files = createDesktopProjectFiles(handles, { fetchRoute, events: new EventTarget() });

    await expect(files.recentFiles.isSameFile(handleRef('sign.LF2'), PATH_REF)).resolves.toBe(true);
  });

  it('keeps them apart when the facts differ or a name does not match', async () => {
    const handles = handleAdapter({
      probe: vi.fn(async () => ({ kind: 'present' as const, size: 8, modifiedMs: 1000 })),
    });
    const fetchRoute = routeFetch({
      './api/desktop-project-status': { body: { kind: 'present', size: 7, modifiedMs: 1000 } },
    });
    const files = createDesktopProjectFiles(handles, { fetchRoute, events: new EventTarget() });

    await expect(files.recentFiles.isSameFile(PATH_REF, handleRef('Sign.lf2'))).resolves.toBe(
      false,
    );
    await expect(files.recentFiles.isSameFile(PATH_REF, handleRef('Other.lf2'))).resolves.toBe(
      false,
    );
    expect(handles.probe).toHaveBeenCalledOnce();
  });
});

describe('desktop operating-system opens', () => {
  const queued = {
    requests: [
      { kind: 'file', name: 'Sign.lf2', path: 'D:\\Jobs\\Sign.lf2', token: TOKEN, size: 7 },
      { kind: 'unavailable', name: 'gone.lf2', reason: 'missing' },
      { kind: 'file', name: 'forged.lf2', path: 'C:\\x.lf2', token: 'short', size: 1 },
    ],
  };

  it('collects the queue when the app subscribes and reads each file only when opened', async () => {
    const fetchRoute = routeFetch({
      './api/desktop-project-opens': { body: queued },
      './api/desktop-project-file': { bytes: '{"v":7}' },
    });
    const files = createDesktopProjectFiles(undefined, { fetchRoute, events: new EventTarget() });
    const received: ExternalFileOpenRequest[] = [];

    files.externalFileOpens.subscribe((request) => received.push(request));
    await vi.waitFor(() => expect(received).toHaveLength(2));

    expect(received[1]).toEqual({ kind: 'unavailable', name: 'gone.lf2', reason: 'missing' });
    const first = received[0];
    if (first?.kind !== 'file') throw new Error('expected a file request');
    expect(first.file).toMatchObject({ name: 'Sign.lf2', size: 7, recentRef: PATH_REF });
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    await expect(first.file.blob?.()).resolves.toMatchObject({ size: 7 });
    expect(fetchRoute).toHaveBeenCalledTimes(2);
  });

  it('collects again when main signals a new open', async () => {
    const fetchRoute = routeFetch({ './api/desktop-project-opens': { body: { requests: [] } } });
    const events = new EventTarget();
    const files = createDesktopProjectFiles(undefined, { fetchRoute, events });
    files.externalFileOpens.subscribe(vi.fn());
    await vi.waitFor(() => expect(fetchRoute).toHaveBeenCalledTimes(1));

    events.dispatchEvent(new Event(DESKTOP_PROJECT_OPEN_EVENT));

    await vi.waitFor(() => expect(fetchRoute).toHaveBeenCalledTimes(2));
  });

  it('explains a queued file that vanished before the open ran', async () => {
    const fetchRoute = routeFetch({
      './api/desktop-project-opens': { body: queued },
      './api/desktop-project-file': { status: 404, body: { kind: 'missing' } },
    });
    const files = createDesktopProjectFiles(undefined, { fetchRoute, events: new EventTarget() });
    const received: ExternalFileOpenRequest[] = [];
    files.externalFileOpens.subscribe((request) => received.push(request));
    await vi.waitFor(() => expect(received).toHaveLength(2));
    const first = received[0];
    if (first?.kind !== 'file') throw new Error('expected a file request');

    await expect(first.file.text()).rejects.toThrow('the file is no longer there.');
  });

  it('stays quiet where the route does not exist', async () => {
    const fetchRoute = routeFetch({ './api/desktop-project-opens': { bytes: '<!doctype html>' } });
    const files = createDesktopProjectFiles(undefined, { fetchRoute, events: new EventTarget() });
    const listener = vi.fn();

    files.externalFileOpens.subscribe(listener);
    await vi.waitFor(() => expect(fetchRoute).toHaveBeenCalled());

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('desktop project response parsing', () => {
  it('drops malformed requests and caps a flood', () => {
    const flood = Array.from({ length: 40 }, () => ({
      kind: 'unavailable',
      name: 'x.lf2',
      reason: 'invalid',
    }));

    expect(parseDesktopOpenRequests({ requests: flood })).toHaveLength(16);
    expect(parseDesktopOpenRequests({ requests: [{ kind: 'unavailable', name: 'x' }] })).toEqual(
      [],
    );
    expect(parseDesktopOpenRequests([])).toEqual([]);
    expect(parseDesktopProbe({ kind: 'present', size: -1, modifiedMs: 1 })).toEqual({
      kind: 'unknown',
    });
    expect(parseDesktopProbe({ kind: 'missing' })).toEqual({ kind: 'missing' });
  });
});
