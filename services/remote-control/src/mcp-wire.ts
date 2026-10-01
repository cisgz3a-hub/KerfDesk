import { z } from 'zod';
import { bodyJson, digest, json } from './security.js';
import { device } from './relay.js';
import type { OAuthGrantProps, RemoteScope, McpReservation } from './protocol.js';

const wireId = z.union([z.string().max(512), z.number().int().safe()]);
const toolRequest = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('tools/call'),
  id: wireId,
});
const cancellation = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('notifications/cancelled'),
  id: z.never().optional(),
  params: z.object({ requestId: wireId }),
});

export type McpExchange = { reservation?: McpReservation; response?: Response };

function invalidToolMessage(value: unknown, valid: boolean): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'method' in value &&
    value.method === 'tools/call' &&
    !valid
  );
}

/** The provider verifies props/client identity before any cancellation association is derived. */
export async function prepareMcpExchange(
  request: Request,
  env: Env,
  props: OAuthGrantProps,
  scopes: RemoteScope,
  oauthClientId: string,
): Promise<McpExchange> {
  if (
    request.method !== 'POST' ||
    request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json'
  )
    return {};
  const value = await bodyJson(request.clone());
  const cancel = cancellation.safeParse(value);
  const tool = toolRequest.safeParse(value);
  if (invalidToolMessage(value, tool.success))
    return { response: json({ error: 'invalid_request' }, 400) };
  const id = cancel.success
    ? cancel.data.params.requestId
    : tool.success
      ? tool.data.id
      : undefined;
  if (id === undefined) return {};
  const key = await digest(JSON.stringify(['mcp-v1', oauthClientId, props.mcpGrantId, id]));
  const stub = device(env, props.deviceId);
  if (cancel.success) {
    await stub.cancelMcpRequest(props, scopes, key);
    return { response: new Response(null, { status: 202 }) };
  }
  const reservationId = await stub.beginMcpRequest(props, scopes, key);
  return reservationId
    ? { reservation: { key, id: reservationId } }
    : { response: json({ error: 'unavailable' }, 503) };
}
