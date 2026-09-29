import { trustedAppRequest } from './app-route-guard.js';
import type { SupportLog } from './support-log.js';

const PREFIX = '/api/support/';
const LOG_PATH = '/api/support/log';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
type ProtocolHandler = (request: Request) => Promise<Response>;

/**
 * Gives KerfDesk's own window the newest part of the support log for Help >
 * Save Support Report (ADR-546). It answers only a same-origin app://app
 * request that carries the support header, the same checks as the licensing
 * routes, so no web page or other program can read the log through it.
 */
export function withSupportRoutes(
  fallback: ProtocolHandler,
  log: Pick<SupportLog, 'recent'>,
): ProtocolHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return fallback(request);
    if (
      url.pathname !== LOG_PATH ||
      request.method !== 'GET' ||
      !trustedAppRequest(request, url, 'X-KerfDesk-Support')
    )
      return new Response('Not Found', { status: 404, headers: HEADERS });
    return new Response(log.recent(), {
      status: 200,
      headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  };
}
