import { createMcpHandler } from '@modelcontextprotocol/server';
import type { OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import { createKerfDeskMcpServer } from '../../../electron/mcp/server.js';
import { mcpOutputSchemas } from '../../../electron/mcp/output-schemas.js';
import { mcpCommandScope, type KerfDeskMcpCommand } from '../../../electron/mcp/input-schemas.js';
import {
  RESOURCE,
  MAX_BYTES,
  oauthGrantSchema,
  oauthScopes,
  type OAuthGrantProps,
  type McpReservation,
  type RemoteScope,
} from './protocol.js';
import { bodyJson, json } from './security.js';
import { device, relayRequest } from './relay.js';
import { prepareMcpExchange } from './mcp-wire.js';
import { mcpAuthChallenge, remoteToolMetadata } from './mcp-auth.js';
import { abortRequest, clientLimited, rateLimited } from './limits.js';

async function permittedContext(env: Env, ctx: ExecutionContext) {
  const context = ctx as OAuthResourceContext<unknown>;
  const props = oauthGrantSchema.safeParse(context.props);
  const rawScopes = context.auth?.scope;
  const scopes =
    Array.isArray(rawScopes) && rawScopes.every((item) => typeof item === 'string')
      ? oauthScopes(rawScopes)
      : null;
  if (
    !props.success ||
    !scopes ||
    context.auth?.audience !== RESOURCE ||
    typeof context.auth.clientId !== 'string' ||
    !context.auth.clientId ||
    !(await device(env, props.data.deviceId).authorize(props.data, scopes))
  )
    return null;

  return { props: props.data, scopes, oauthClientId: context.auth.clientId };
}
function callScope(value: unknown): 'read' | 'edit' | 'control' {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('method' in value) ||
    value.method !== 'tools/call' ||
    !('params' in value)
  )
    return 'read';
  const params = value.params;
  const valid =
    typeof params === 'object' &&
    params !== null &&
    'name' in params &&
    typeof params.name === 'string' &&
    Object.hasOwn(mcpOutputSchemas, params.name);
  return valid ? mcpCommandScope((params as { name: KerfDeskMcpCommand }).name) : 'read';
}
async function scopeChallenge(request: Request, scopes: RemoteScope) {
  if (
    request.method === 'POST' &&
    (!scopes.includes('edit') || !scopes.includes('control')) &&
    request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json'
  ) {
    const message = await bodyJson(request.clone());
    const messages = Array.isArray(message) ? message : [message];
    const required = [
      ...new Set(
        messages.map(callScope).filter((scope): scope is 'edit' | 'control' => scope !== 'read'),
      ),
    ];
    if (required.some((scope) => !scopes.includes(scope)))
      return json(
        {
          error: 'insufficient_scope',
          error_description: required.includes('control')
            ? 'Machine control requires separate approval on this computer.'
            : 'Editing requires approval on this computer.',
        },
        403,
        {
          'WWW-Authenticate': mcpAuthChallenge('insufficient_scope', required),
        },
      );
  }

  return null;
}
async function pumpResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  handler: ReturnType<typeof createMcpHandler>,
  exchange: AbortController,
  ready: () => void,
  release: () => Promise<void>,
) {
  try {
    await writer.write(new TextEncoder().encode(': connected\n\n'));
    ready();
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      await writer.write(item.value);
    }
    await writer.close();
  } catch {
    exchange.abort();
    ready();
    await writer.abort(new Error('MCP exchange unavailable.')).catch(() => undefined);
  } finally {
    await Promise.allSettled([reader.cancel(), handler.close(), release()]);
  }
}
async function streamExchange(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  props: OAuthGrantProps,
  scopes: RemoteScope,
  reservation?: McpReservation,
): Promise<Response> {
  const exchange = new AbortController();
  const release = () =>
    reservation
      ? device(env, props.deviceId)
          .endMcpRequest(props, reservation)
          .catch(() => undefined)
      : Promise.resolve();
  let ready: () => void = () => undefined;
  const streaming = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const handler = createMcpHandler(
    () =>
      createKerfDeskMcpServer(
        {
          async request(name, args, signal) {
            await streaming;
            return relayRequest(
              env,
              props,
              scopes,
              name,
              args,
              AbortSignal.any([request.signal, exchange.signal, ...(signal ? [signal] : [])]),
              undefined,
              ctx,
              reservation,
            );
          },
        },
        remoteToolMetadata,
      ),
    { maxRequestBodySize: MAX_BYTES, keepAliveMs: 1000, responseMode: 'sse' },
  );
  // Both modern (2026-07-28) and legacy stateless Streamable HTTP are supported by the SDK.
  let response: Response;
  try {
    response = await handler.fetch(request);
  } catch (error) {
    await Promise.allSettled([handler.close(), release()]);
    throw error;
  }
  if (
    !response.body ||
    response.headers.get('Content-Type')?.split(';')[0].trim() !== 'text/event-stream'
  ) {
    await Promise.allSettled([handler.close(), release()]);
    return response;
  }
  const reader = response.body.getReader();
  const { readable, writable } = new IdentityTransformStream();
  const writer = writable.getWriter();
  // Native stream cancellation is independent of a pending JS reader.read()/RPC.
  void writer.closed.catch(() => {
    exchange.abort();
    ready();
  });
  ctx.waitUntil(pumpResponse(reader, writer, handler, exchange, ready, release));
  return new Response(readable, { status: response.status, headers: response.headers });
}
export const protectedHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const permitted = await permittedContext(env, ctx);
    if (!permitted)
      return json(
        { error: 'invalid_token', error_description: 'This computer approval is unavailable.' },
        401,
        { 'WWW-Authenticate': mcpAuthChallenge('invalid_token') },
      );
    const challenge = await scopeChallenge(request, permitted.scopes);
    if (challenge) return challenge;
    const abort = await abortRequest(request, '/mcp');
    if (await clientLimited(env, permitted.props, abort)) return rateLimited();
    const prepared = await prepareMcpExchange(
      request,
      env,
      permitted.props,
      permitted.scopes,
      permitted.oauthClientId,
    );
    return (
      prepared.response ??
      streamExchange(request, env, ctx, permitted.props, permitted.scopes, prepared.reservation)
    );
  },
} satisfies ExportedHandler<Env>;
