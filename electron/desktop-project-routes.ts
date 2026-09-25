// Exact same-origin routes for project files the operating system handed
// over (ADR-378). Like the Preview update check (ADR-249) they need no preload
// or IPC: the renderer fetches app://app/api/desktop-project-* and main answers.
//
//   GET /api/desktop-project-opens                    drain the open queue
//   GET /api/desktop-project-status?path=&token=      exists? size, mtime
//   GET /api/desktop-project-file?path=&token=        the file's bytes
//
// Any other method, host, port, credentials, fragment, extra or repeated query
// parameter gets 404. A path needs main's token for exactly that path, and it
// is checked again as a regular project file before every answer.

import type { DesktopProjectFile, DesktopProjectFileCheck } from './desktop-project-file-check.js';
import type { DesktopProjectOpenRequest } from './desktop-project-open-queue.js';
import { MAX_DESKTOP_PROJECT_PATH_LENGTH } from './desktop-project-paths.js';
import type { DesktopProjectTokens } from './desktop-project-token.js';

export const DESKTOP_PROJECT_FILE_PATH = '/api/desktop-project-file';
export const DESKTOP_PROJECT_STATUS_PATH = '/api/desktop-project-status';
export const DESKTOP_PROJECT_OPENS_PATH = '/api/desktop-project-opens';
const ROUTE_PREFIX = '/api/desktop-project-';

export type AppProtocolHandler = (request: Request) => Promise<Response>;

export type DesktopProjectRouteDeps = {
  readonly tokens: () => Promise<DesktopProjectTokens>;
  readonly check: (file: string) => Promise<DesktopProjectFileCheck>;
  readonly read: (file: DesktopProjectFile) => Response;
  readonly drainOpens: () => Promise<ReadonlyArray<DesktopProjectOpenRequest>>;
};

type PathQuery = { readonly path: string; readonly token: string };

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

export function withDesktopProjectRoutes(
  fallback: AppProtocolHandler,
  deps: DesktopProjectRouteDeps,
): AppProtocolHandler {
  return async (request) => {
    const url = appUrl(request.url);
    if (url === null || !url.pathname.startsWith(ROUTE_PREFIX)) return fallback(request);
    try {
      return await answerDesktopProjectRoute(request, url, deps);
    } catch (error) {
      console.warn('Desktop project route failed:', error);
      return jsonResponse(500, { kind: 'unreadable' });
    }
  };
}

async function answerDesktopProjectRoute(
  request: Request,
  url: URL,
  deps: DesktopProjectRouteDeps,
): Promise<Response> {
  if (!isExactAppRequest(request, url)) return notFound();
  switch (url.pathname) {
    case DESKTOP_PROJECT_OPENS_PATH:
      return url.search === ''
        ? jsonResponse(200, { requests: await deps.drainOpens() })
        : notFound();
    case DESKTOP_PROJECT_FILE_PATH:
      return answerPathRoute(url, deps, true);
    case DESKTOP_PROJECT_STATUS_PATH:
      return answerPathRoute(url, deps, false);
    default:
      return notFound();
  }
}

// The status route always answers 200 with a kind, so a Recent Projects check
// never surfaces as a failed request; the file route uses HTTP statuses.
async function answerPathRoute(
  url: URL,
  deps: DesktopProjectRouteDeps,
  wantsBytes: boolean,
): Promise<Response> {
  const query = pathQuery(url);
  if (query === null) return notFound();
  if (!(await deps.tokens()).verify(query.path, query.token)) {
    return jsonResponse(wantsBytes ? 403 : 200, { kind: 'denied' });
  }
  const checked = await deps.check(query.path);
  if (checked.kind !== 'file') {
    return jsonResponse(wantsBytes ? failureStatus(checked.kind) : 200, { kind: checked.kind });
  }
  if (wantsBytes) return deps.read(checked);
  return jsonResponse(200, { kind: 'present', size: checked.size, modifiedMs: checked.modifiedMs });
}

function appUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'app:' && url.hostname === 'app' ? url : null;
  } catch {
    return null;
  }
}

function isExactAppRequest(request: Request, url: URL): boolean {
  return (
    request.method === 'GET' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    url.hash === ''
  );
}

/** Exactly one `path` and one `token`, nothing else. */
function pathQuery(url: URL): PathQuery | null {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || !keys.includes('path') || !keys.includes('token')) return null;
  const file = url.searchParams.get('path');
  const token = url.searchParams.get('token');
  if (file === null || token === null) return null;
  if (file.length === 0 || file.length > MAX_DESKTOP_PROJECT_PATH_LENGTH) return null;
  return { path: file, token };
}

function failureStatus(kind: 'missing' | 'invalid' | 'unreadable'): number {
  if (kind === 'missing') return 404;
  return kind === 'invalid' ? 415 : 500;
}

function notFound(): Response {
  return new Response('Not Found', { status: 404, headers: NO_STORE_HEADERS });
}

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Response headers for a project file's bytes. */
export const DESKTOP_PROJECT_FILE_HEADERS = {
  ...NO_STORE_HEADERS,
  'Content-Type': 'application/octet-stream',
} as const;
