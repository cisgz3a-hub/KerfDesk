// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { DesktopProjectFileCheck } from './desktop-project-file-check.js';
import {
  withDesktopProjectRoutes,
  type DesktopProjectRouteDeps,
} from './desktop-project-routes.js';
import { createDesktopProjectTokens } from './desktop-project-token.js';

const tokens = createDesktopProjectTokens(new Uint8Array(32).fill(5));
const FILE = '/jobs/sign.lf2';
const TOKEN = tokens.mint(FILE);

const present: DesktopProjectFileCheck = {
  kind: 'file',
  path: FILE,
  realPath: '/real/sign.lf2',
  name: 'sign.lf2',
  size: 12,
  modifiedMs: 1_700_000_000_000,
};

function routes(overrides: Partial<DesktopProjectRouteDeps> = {}) {
  const deps: DesktopProjectRouteDeps = {
    tokens: async () => tokens,
    check: vi.fn(async () => present),
    read: vi.fn(() => new Response('bytes')),
    drainOpens: vi.fn(async () => []),
    save: vi.fn(async () => 'saved' as const),
    ...overrides,
  };
  return { handler: withDesktopProjectRoutes(async () => new Response('bundle'), deps), deps };
}

function saveRequest(
  options: {
    readonly path?: string;
    readonly token?: string;
    readonly headers?: Record<string, string>;
    readonly url?: string;
  } = {},
): Request {
  const query = new URLSearchParams({
    path: options.path ?? FILE,
    token: options.token ?? TOKEN,
  });
  return new Request(options.url ?? `app://app/api/desktop-project-file?${query.toString()}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-KerfDesk-Project': '1',
      ...options.headers,
    },
    body: '{"schemaVersion":7}',
  });
}

describe('the desktop project save route (ADR-550)', () => {
  it('saves the checked project file and answers 204', async () => {
    const { handler, deps } = routes();

    const response = await handler(saveRequest());

    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(deps.check).toHaveBeenCalledWith(FILE);
    const [file, body] = vi.mocked(deps.save).mock.calls[0] ?? [];
    expect(file).toBe(present);
    expect(await new Response(body).text()).toBe('{"schemaVersion":7}');
  });

  it('refuses a path main did not hand over', async () => {
    const { handler, deps } = routes();
    const response = await handler(saveRequest({ path: '/jobs/other.lf2' }));
    expect(response.status).toBe(403);
    expect(deps.check).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it('never replaces a LightBurn file, or a project that resolves to one', async () => {
    const lightBurn = '/jobs/sign.lbrn2';
    const { handler, deps } = routes();
    const direct = await handler(saveRequest({ path: lightBurn, token: tokens.mint(lightBurn) }));
    expect(direct.status).toBe(415);

    const linked = routes({ check: async () => ({ ...present, realPath: '/real/sign.lbrn2' }) });
    expect((await linked.handler(saveRequest())).status).toBe(415);
    expect(deps.save).not.toHaveBeenCalled();
    expect(linked.deps.save).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', 404],
    ['invalid', 415],
    ['unreadable', 500],
  ] as const)('answers a %s file with %i', async (kind, status) => {
    const { handler, deps } = routes({ check: async () => ({ kind }) });
    const response = await handler(saveRequest());
    expect(response.status).toBe(status);
    expect(deps.save).not.toHaveBeenCalled();
  });

  it.each([
    ['too-large', 413],
    ['failed', 500],
  ] as const)('answers a %s save with %i', async (result, status) => {
    const { handler } = routes({ save: async () => result });
    const response = await handler(saveRequest());
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ kind: result });
  });

  it.each([
    ['no KerfDesk header', { headers: { 'X-KerfDesk-Project': '0' } }],
    ['another origin', { headers: { Origin: 'https://evil.example' } }],
    ['a cross-site fetch', { headers: { 'Sec-Fetch-Site': 'cross-site' } }],
    ['another content type', { headers: { 'Content-Type': 'text/plain' } }],
    [
      'an extra parameter',
      { url: `app://app/api/desktop-project-file?path=${FILE}&token=${TOKEN}&x=1` },
    ],
    ['a missing token', { url: `app://app/api/desktop-project-file?path=${FILE}` }],
    ['a fragment', { url: `app://app/api/desktop-project-file?path=${FILE}&token=${TOKEN}#x` }],
    [
      'the status route',
      { url: `app://app/api/desktop-project-status?path=${FILE}&token=${TOKEN}` },
    ],
  ])('answers 404 to %s', async (_label, options) => {
    const { handler, deps } = routes();
    const response = await handler(saveRequest(options));
    expect(response.status).toBe(404);
    expect(deps.save).not.toHaveBeenCalled();
  });
});
