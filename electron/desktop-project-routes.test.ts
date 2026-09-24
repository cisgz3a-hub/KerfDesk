// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { DesktopProjectFileCheck } from './desktop-project-file-check.js';
import { createDesktopProjectOpenQueue } from './desktop-project-open-queue.js';
import {
  DESKTOP_PROJECT_FILE_HEADERS,
  withDesktopProjectRoutes,
  type DesktopProjectRouteDeps,
} from './desktop-project-routes.js';
import { createDesktopProjectTokens } from './desktop-project-token.js';

const tokens = createDesktopProjectTokens(new Uint8Array(32).fill(3));
const FILE = '/jobs/sign.lf2';
const TOKEN = tokens.mint(FILE);

const present: DesktopProjectFileCheck = {
  kind: 'file',
  path: FILE,
  realPath: FILE,
  name: 'sign.lf2',
  size: 12,
  modifiedMs: 1_700_000_000_000.5,
};

function routes(overrides: Partial<DesktopProjectRouteDeps> = {}) {
  const fallback = vi.fn(async () => new Response('bundle'));
  const deps: DesktopProjectRouteDeps = {
    tokens: async () => tokens,
    check: vi.fn(async () => present),
    read: vi.fn(() => new Response('{"project":1}', { headers: DESKTOP_PROJECT_FILE_HEADERS })),
    drainOpens: vi.fn(async () => []),
    ...overrides,
  };
  return { handler: withDesktopProjectRoutes(fallback, deps), fallback, deps };
}

function query(route: string, params: Record<string, string> = { path: FILE, token: TOKEN }) {
  return `app://app/api/desktop-project-${route}?${new URLSearchParams(params).toString()}`;
}

describe('desktop project routes', () => {
  it('leaves every other app:// request to the bundle handler', async () => {
    const { handler, fallback } = routes();

    await handler(new Request('app://app/index.html'));
    await handler(new Request('app://app/api/desktop-preview-update'));

    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it('serves the bytes of a tokened, checked project file', async () => {
    const { handler, deps } = routes();

    const response = await handler(new Request(query('file')));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('{"project":1}');
    expect(deps.check).toHaveBeenCalledWith(FILE);
    expect(deps.read).toHaveBeenCalledWith(present);
  });

  it('refuses a path main never handed over, before touching the disk', async () => {
    const { handler, deps } = routes();

    const response = await handler(
      new Request(query('file', { path: 'C:\\Windows\\win.ini', token: TOKEN })),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ kind: 'denied' });
    expect(deps.check).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', 404],
    ['invalid', 415],
    ['unreadable', 500],
  ] as const)('answers a %s file with %i and its kind', async (kind, status) => {
    const { handler, deps } = routes({ check: async () => ({ kind }) });

    const response = await handler(new Request(query('file')));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ kind });
    expect(deps.read).not.toHaveBeenCalled();
  });

  it('reports status as data, including a refused token', async () => {
    const { handler } = routes();

    const ok = await handler(new Request(query('status')));
    const denied = await handler(new Request(query('status', { path: FILE, token: 'x' })));

    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({
      kind: 'present',
      size: 12,
      modifiedMs: 1_700_000_000_000.5,
    });
    expect(denied.status).toBe(200);
    await expect(denied.json()).resolves.toEqual({ kind: 'denied' });
  });

  // Only method and URL are read, so plain objects stand in for requests the
  // Fetch API itself refuses to construct (credentials in the URL).
  it.each([
    ['a POST', 'POST', query('file')],
    ['an extra parameter', 'GET', `${query('file')}&also=1`],
    ['a repeated path', 'GET', `${query('file')}&path=${encodeURIComponent(FILE)}`],
    ['a missing token', 'GET', query('file', { path: FILE })],
    ['a fragment', 'GET', `${query('file')}#x`],
    ['credentials', 'GET', 'app://me:pw@app/api/desktop-project-opens'],
    ['a port', 'GET', 'app://app:8080/api/desktop-project-opens'],
    ['a query on the queue', 'GET', 'app://app/api/desktop-project-opens?all=1'],
    ['an unknown route', 'GET', 'app://app/api/desktop-project-delete'],
  ])('answers 404 to %s', async (_label, method, url) => {
    const { handler, deps } = routes();

    const response = await handler({ method, url } as Request);

    expect(response.status).toBe(404);
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.drainOpens).not.toHaveBeenCalled();
  });

  it('drains the open queue with a token minted for each checked file', async () => {
    const queue = createDesktopProjectOpenQueue();
    queue.add([FILE, '/jobs/gone.lf2']);
    const check = async (file: string): Promise<DesktopProjectFileCheck> =>
      file === FILE ? present : { kind: 'missing' };
    const { handler } = routes({ drainOpens: () => queue.drain(tokens, check) });

    const first = await handler(new Request('app://app/api/desktop-project-opens'));
    const second = await handler(new Request('app://app/api/desktop-project-opens'));

    await expect(first.json()).resolves.toEqual({
      requests: [
        { kind: 'file', name: 'sign.lf2', path: FILE, token: TOKEN, size: 12 },
        { kind: 'unavailable', name: 'gone.lf2', reason: 'missing' },
      ],
    });
    await expect(second.json()).resolves.toEqual({ requests: [] });
  });

  it('turns an unexpected failure into a 500 instead of a broken protocol handler', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { handler } = routes({
      check: async () => {
        throw new Error('disk exploded');
      },
    });

    const response = await handler(new Request(query('file')));

    expect(response.status).toBe(500);
    warn.mockRestore();
  });
});

describe('createDesktopProjectOpenQueue', () => {
  it('keeps the newest requests when a burst overflows it', async () => {
    const queue = createDesktopProjectOpenQueue(2);
    queue.add(['/a.lf2', '/b.lf2']);
    queue.add(['/c.lf2']);

    const drained = await queue.drain(tokens, async (file) => ({ ...present, path: file }));

    expect(drained.map((request) => (request.kind === 'file' ? request.path : ''))).toEqual([
      '/b.lf2',
      '/c.lf2',
    ]);
  });
});
