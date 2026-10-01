import { createMcpHandler } from '@modelcontextprotocol/server';
import { createKerfDeskMcpServer } from '../../../electron/mcp/server.js';
import type { mcpOutputSchemas } from '../../../electron/mcp/output-schemas.js';
import {
  PUBLIC_ORIGIN,
  RESOURCE,
  MAX_BYTES,
  OAUTH_READ,
  OAUTH_EDIT,
  WRITE_COMMANDS,
  grantSchema,
  oauthScopes,
  type GrantProps,
  type RemoteScope,
} from './protocol.js';
import { bodyJson, json } from './security.js';
import { device, relayRequest } from './relay.js';

async function permittedContext(env: Env, ctx: ExecutionContext) {
  const context = ctx as ExecutionContext<unknown> & {
    auth?: { audience?: unknown; scope?: unknown };
  };
  const props = grantSchema.safeParse(context.props);
  const rawScopes = context.auth?.scope;
  const scopes =
    Array.isArray(rawScopes) && rawScopes.every((item) => typeof item === 'string')
      ? oauthScopes(rawScopes)
      : null;
  if (
    !props.success ||
    !scopes ||
    context.auth?.audience !== RESOURCE ||
    !(await device(env, props.data.deviceId).authorize(props.data, scopes))
  )
    return null;

  return { props: props.data, scopes };
}
function isWriteCall(value: unknown): boolean {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('method' in value) ||
    value.method !== 'tools/call' ||
    !('params' in value)
  )
    return false;
  const params = value.params;
  return (
    typeof params === 'object' &&
    params !== null &&
    'name' in params &&
    typeof params.name === 'string' &&
    WRITE_COMMANDS.has(params.name as keyof typeof mcpOutputSchemas)
  );
}
async function scopeChallenge(request: Request, scopes: RemoteScope) {
  if (
    request.method === 'POST' &&
    !scopes.includes('edit') &&
    request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json'
  ) {
    const message = await bodyJson(request.clone());
    const messages = Array.isArray(message) ? message : [message];
    const writeRequested = messages.some(isWriteCall);
    if (writeRequested)
      return json(
        {
          error: 'insufficient_scope',
          error_description: 'Editing requires approval on this computer.',
        },
        403,
        {
          'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${OAUTH_READ} ${OAUTH_EDIT}", resource_metadata="${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
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
    await Promise.allSettled([reader.cancel(), handler.close()]);
  }
}
async function streamExchange(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  props: GrantProps,
  scopes: RemoteScope,
): Promise<Response> {
  const exchange = new AbortController();
  let ready: () => void = () => undefined;
  const streaming = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const handler = createMcpHandler(
    () =>
      createKerfDeskMcpServer({
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
          );
        },
      }),
    { maxRequestBodySize: MAX_BYTES, keepAliveMs: 1000, responseMode: 'sse' },
  );
  // Both modern (2026-07-28) and legacy stateless Streamable HTTP are supported by the SDK.
  const response = await handler.fetch(request);
  if (
    !response.body ||
    response.headers.get('Content-Type')?.split(';')[0].trim() !== 'text/event-stream'
  ) {
    await handler.close();
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
  ctx.waitUntil(pumpResponse(reader, writer, handler, exchange, ready));
  return new Response(readable, { status: response.status, headers: response.headers });
}
export const protectedHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const permitted = await permittedContext(env, ctx);
    if (!permitted)
      return json(
        { error: 'invalid_token', error_description: 'This computer approval is unavailable.' },
        401,
      );
    const challenge = await scopeChallenge(request, permitted.scopes);
    return challenge ?? streamExchange(request, env, ctx, permitted.props, permitted.scopes);
  },
} satisfies ExportedHandler<Env>;
