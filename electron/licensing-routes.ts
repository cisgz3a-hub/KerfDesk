import type { LicensingRuntime } from './licensing-runtime.js';
import { record } from './licensing-verification.js';

const PREFIX = '/api/licensing/';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
type ProtocolHandler = (request: Request) => Promise<Response>;

export function withLicensingRoutes(
  fallback: ProtocolHandler,
  runtime: LicensingRuntime,
): ProtocolHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return fallback(request);
    if (!exactUrl(url) || !sameOriginHeaders(request)) return missing();
    const action = url.pathname.slice(PREFIX.length);
    if (action === 'status' && request.method === 'GET') return response(await runtime.status());
    if (request.method !== 'POST' || request.headers.get('Content-Type') !== 'application/json')
      return missing();
    const body = await readBody(request);
    if (!record(body)) return response({ error: 'invalid_request' }, 400);
    return dispatch(action, body, runtime);
  };
}

function exactUrl(url: URL): boolean {
  return (
    url.protocol === 'app:' &&
    url.hostname === 'app' &&
    [url.port, url.username, url.password, url.search, url.hash].every((part) => part === '')
  );
}
function sameOriginHeaders(request: Request): boolean {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  return (
    request.headers.get('X-KerfDesk-Licensing') === '1' &&
    (origin === null || origin === 'app://app') &&
    (site === null || site === 'same-origin' || site === 'none')
  );
}
async function dispatch(
  action: string,
  body: Record<string, unknown>,
  runtime: LicensingRuntime,
): Promise<Response> {
  if (action === 'activate')
    return Object.keys(body).length === 1 && typeof body.licenseKey === 'string'
      ? response(await runtime.activate(body.licenseKey))
      : response({ error: 'invalid_request' }, 400);
  if (action === 'checkout') return checkout(body, runtime);
  if (Object.keys(body).length !== 0) return response({ error: 'invalid_request' }, 400);
  const actions = {
    trial: runtime.startTrial,
    refresh: runtime.refresh,
    deactivate: runtime.deactivate,
    launch: runtime.launch,
    'claim-payment': runtime.claimPayment,
  };
  return Object.hasOwn(actions, action)
    ? response(await actions[action as keyof typeof actions]())
    : missing();
}
async function checkout(
  body: Record<string, unknown>,
  runtime: LicensingRuntime,
): Promise<Response> {
  if (
    !['purchase', 'renewal'].includes(String(body.operation)) ||
    Object.keys(body).some((key) => key !== 'operation' && key !== 'licenseKey') ||
    (body.licenseKey !== undefined && typeof body.licenseKey !== 'string')
  )
    return response({ error: 'invalid_request' }, 400);
  return response(
    await runtime.checkout(
      body.operation as 'purchase' | 'renewal',
      body.licenseKey as string | undefined,
    ),
  );
}

async function readBody(request: Request): Promise<unknown> {
  if (request.body === null) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: HEADERS });
}
function missing(): Response {
  return new Response('Not Found', { status: 404, headers: HEADERS });
}
