import { trustedAppRequest } from '../app-route-guard.js';
import { KerfDeskMcpError, mcpErrorCode } from '../mcp/backend.js';
import type { ProtocolHandler } from '../licensing-routes.js';
import type { RemoteAccessRuntime } from './runtime.js';
import type { RemoteRendererQueue } from './renderer-queue.js';
import { object, validRemoteScopes } from './relay-client.js';

const PREFIX = '/api/remote/';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const response = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: HEADERS });
const missing = (): Response => new Response('Not Found', { status: 404, headers: HEADERS });

async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (request.body === null) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 280 * 1024) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return object(value) ? value : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
function fields(value: Record<string, unknown>, allowed: string[]): boolean {
  const names = Object.keys(value).filter((key) => key !== 'sessionId');
  return names.length === allowed.length && names.every((name) => allowed.includes(name));
}
const errorCodes = {
  invalid_arguments: 'invalid_input',
  unsupported_command: 'invalid_input',
  request_conflict: 'invalid_input',
  request_limit: 'unavailable',
  read_only: 'unavailable',
  busy: 'unavailable',
  not_found: 'invalid_input',
  not_editable: 'unsupported_operation',
} as const;
function rendererError(error: Record<string, unknown>): KerfDeskMcpError {
  if (typeof error.code === 'string' && Object.hasOwn(errorCodes, error.code))
    return new KerfDeskMcpError(errorCodes[error.code as keyof typeof errorCodes]);
  return new KerfDeskMcpError(mcpErrorCode(error));
}

class RemoteRoutes {
  constructor(
    private readonly fallback: ProtocolHandler,
    private readonly runtime: RemoteAccessRuntime,
    private readonly queue: RemoteRendererQueue,
  ) {}
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return this.fallback(request);
    if (!trustedAppRequest(request, url, 'X-KerfDesk-Remote')) return missing();
    const action = url.pathname.slice(PREFIX.length);
    if (action === 'status' && request.method === 'GET') return response(this.runtime.status());
    if (request.method !== 'POST' || request.headers.get('Content-Type') !== 'application/json')
      return missing();
    const value = await body(request);
    if (value === null) return response({ error: 'invalid_input' }, 400);
    try {
      return await this.post(action, value);
    } catch {
      return response({ error: 'unavailable' }, 503);
    }
  }
  private async post(action: string, value: Record<string, unknown>): Promise<Response> {
    if (action === 'attach' && Object.keys(value).length === 0) {
      this.runtime.closed();
      const sessionId = this.queue.attach();
      await this.runtime.opened();
      return response({ sessionId });
    }
    if (!this.queue.owns(value.sessionId)) return response({ error: 'unavailable' }, 409);
    return this.dispatch(action, value, value.sessionId as string);
  }
  private async dispatch(
    action: string,
    value: Record<string, unknown>,
    session: string,
  ): Promise<Response> {
    switch (action) {
      case 'poll':
        return this.poll(value, session);
      case 'detach':
        return this.detach(value);
      case 'configure':
        return this.configure(value);
      case 'pair':
        return this.pair(value);
      case 'revoke-all':
        return this.revokeAll(value);
      case 'revoke':
        return this.revoke(value);
      case 'decide':
        return this.decide(value);
      case 'complete':
        return this.complete(value, session);
      default:
        return missing();
    }
  }
  private detach(value: Record<string, unknown>): Response {
    if (!fields(value, [])) return missing();
    this.runtime.closed();
    this.queue.detach();
    return response({ detached: true });
  }
  private poll(value: Record<string, unknown>, session: string): Response {
    return fields(value, [])
      ? response({ ...this.queue.poll(session), status: this.runtime.status() })
      : missing();
  }
  private pair(value: Record<string, unknown>): Response {
    return fields(value, []) ? response(this.runtime.pair()) : missing();
  }
  private async revokeAll(value: Record<string, unknown>): Promise<Response> {
    return fields(value, []) ? response(await this.runtime.revokeAll()) : missing();
  }
  private async revoke(value: Record<string, unknown>): Promise<Response> {
    return fields(value, ['clientId']) && typeof value.clientId === 'string'
      ? response(await this.runtime.revoke(value.clientId))
      : missing();
  }
  private async configure(value: Record<string, unknown>): Promise<Response> {
    if (!fields(value, ['enabled']) || typeof value.enabled !== 'boolean') return missing();
    return response(await this.runtime.configure(value.enabled));
  }
  private decide(value: Record<string, unknown>): Response {
    if (
      !fields(value, ['pairingId', 'approved', 'scopes']) ||
      typeof value.pairingId !== 'string' ||
      typeof value.approved !== 'boolean' ||
      !validRemoteScopes(value.scopes)
    )
      return missing();
    return response(this.runtime.decide(value.pairingId, value.approved, value.scopes));
  }
  private complete(value: Record<string, unknown>, session: string): Response {
    if (!fields(value, ['id', 'result']) || typeof value.id !== 'string' || !object(value.result))
      return missing();
    const result = value.result;
    if (result.ok === true && typeof result.revision === 'string' && object(result.data))
      return response({
        accepted: this.queue.complete(session, value.id, {
          ...result.data,
          revision: result.revision,
        }),
      });
    if (result.ok === false && object(result.error))
      return response({
        accepted: this.queue.complete(session, value.id, rendererError(result.error)),
      });
    return response({ error: 'invalid_input' }, 400);
  }
}

/** Private same-origin routes; native credentials are never returned to the renderer. */
export function withRemoteAccessRoutes(
  fallback: ProtocolHandler,
  runtime: RemoteAccessRuntime,
  queue: RemoteRendererQueue,
): ProtocolHandler {
  const routes = new RemoteRoutes(fallback, runtime, queue);
  return (request) => routes.handle(request);
}
