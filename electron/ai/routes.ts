import { trustedAppRequest } from '../app-route-guard.js';
import { readBoundedJson } from './bounded-json.js';
import { parseAiRequest, record, validConfiguration } from './contracts.js';
import type { AiRuntime } from './runtime.js';
import { AiFailure } from './failure.js';

type Handler = (request: Request) => Promise<Response>;
const PREFIX = '/api/assistant/';
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Type': 'application/json',
};
export function withAiRoutes(fallback: Handler, runtime: AiRuntime): Handler {
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return fallback(request);
    if (!trustedAppRequest(request, url, 'X-KerfDesk-Assistant')) return json({}, 404);
    const action = url.pathname.slice(PREFIX.length);
    try {
      if (action === 'status' && request.method === 'GET') return json(await runtime.status());
      if (request.method !== 'POST' || request.headers.get('Content-Type') !== 'application/json')
        return json({}, 404);
      if (!['configure', 'forget', 'generate', 'cancel'].includes(action)) return json({}, 404);
      if (action === 'generate') return await generate(request, runtime);
      const body = await readBoundedJson(request, 12_000);
      return await dispatch(action, body, runtime);
    } catch (error) {
      // Never reflect provider payloads, credentials, file paths, or network error text.
      return json({ error: publicFailure(error) }, 400);
    }
  };
}
async function generate(request: Request, runtime: AiRuntime): Promise<Response> {
  const id = request.headers.get('X-KerfDesk-Assistant-Request');
  if (id === null || !/^[0-9a-f-]{36}$/i.test(id))
    return json({ error: 'Invalid assistant request.' }, 400);
  const prepare = async (signal: AbortSignal) => {
    const body = await readBoundedJson(request, 2_000_000, signal);
    if (!record(body) || body['requestId'] !== id)
      throw new AiFailure('Invalid assistant request.');
    return parseAiRequest(body['request']);
  };
  return json(await runtime.generate(id, prepare, request.signal));
}
async function dispatch(action: string, body: unknown, runtime: AiRuntime): Promise<Response> {
  if (action === 'configure' && validConfiguration(body))
    return json(await runtime.configure({ apiKey: body.apiKey, model: body.model }));
  if (!record(body)) return json({ error: 'Invalid assistant request.' }, 400);
  if (action === 'forget' && Object.keys(body).length === 0) return json(await runtime.forget());
  const id = body['requestId'];
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
    return json({ error: 'Invalid assistant request.' }, 400);
  if (action === 'cancel') {
    runtime.cancel(id);
    return json({ cancelled: true });
  }
  return json({ error: 'Invalid assistant request.' }, 400);
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
function publicFailure(error: unknown): string {
  if (error instanceof AiFailure) return error.message.slice(0, 300);
  return 'The assistant request failed. No changes were applied.';
}
