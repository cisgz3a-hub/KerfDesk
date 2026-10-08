import {
  isJsonContentType,
  isLegacyRequest,
  parseJSONRPCMessage,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { bodyJson, digest, json, RequestFailure } from './security.js';
import { device } from './relay.js';
import {
  MAX_BYTES,
  type OAuthGrantProps,
  type RemoteScope,
  type McpReservation,
} from './protocol.js';

const wireId = z.union([z.string().max(512), z.number().int().safe()]);
const toolRequest = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('tools/call'),
  id: wireId,
  params: z.object({ name: z.string().max(128) }).optional(),
});
const cancellation = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('notifications/cancelled'),
  id: z.never().optional(),
  params: z.object({ requestId: wireId }),
});
type ToolRequest = z.infer<typeof toolRequest>;
type Cancellation = z.infer<typeof cancellation>;
export type McpReservations = Map<string | number, McpReservation | null>;
export type McpExchange = {
  reservations?: McpReservations;
  request?: Request;
  response?: Response;
};

function messageAssociation(value: unknown): ToolRequest | Cancellation | undefined {
  const tool = toolRequest.safeParse(value);
  if (tool.success) return tool.data;
  const cancel = cancellation.safeParse(value);
  if (cancel.success) return cancel.data;
  if (
    typeof value === 'object' &&
    value !== null &&
    'method' in value &&
    ['tools/call', 'notifications/cancelled'].includes(String(value.method))
  )
    throw new RequestFailure(400);
  return undefined;
}

function batchAssociations(values: unknown[]): (ToolRequest | Cancellation | undefined)[] {
  const ids = new Set<string | number>();
  return values.map((value) => {
    let message;
    try {
      message = parseJSONRPCMessage(value);
    } catch {
      throw new RequestFailure(400);
    }
    if ('id' in message) {
      const id = wireId.safeParse(message.id);
      if (!id.success) throw new RequestFailure(400);
      if ('method' in message) {
        if (ids.has(id.data)) throw new RequestFailure(400);
        ids.add(id.data);
      }
    }
    return messageAssociation(value);
  });
}

export async function releaseMcpReservations(
  env: Env,
  props: OAuthGrantProps,
  reservations: McpReservations,
): Promise<void> {
  const stub = device(env, props.deviceId);
  await Promise.allSettled(
    [...reservations.values()].map((reservation) =>
      reservation ? stub.endMcpRequest(props, reservation) : Promise.resolve(),
    ),
  );
}

async function associateMessages(
  env: Env,
  props: OAuthGrantProps,
  scopes: RemoteScope,
  oauthClientId: string,
  messages: (ToolRequest | Cancellation | undefined)[],
): Promise<McpReservations> {
  const reservations: McpReservations = new Map();
  const stub = device(env, props.deviceId);
  const key = (id: string | number) =>
    digest(JSON.stringify(['mcp-v1', oauthClientId, props.mcpGrantId, id]));
  try {
    for (const message of messages) {
      if (message?.method !== 'tools/call') continue;
      const wireKey = await key(message.id);
      const id = await stub.beginMcpRequest(
        props,
        scopes,
        wireKey,
        message.params?.name === 'abort_job',
      );
      // An accepted batch keeps a separate unavailable result for capacity-denied members.
      reservations.set(message.id, id ? { key: wireKey, id } : null);
    }
    // Register calls first so either ordering of a call/cancel pair fences dispatch.
    for (const message of messages)
      if (message?.method === 'notifications/cancelled')
        await stub.cancelMcpRequest(props, scopes, await key(message.params.requestId));
    return reservations;
  } catch (error) {
    await releaseMcpReservations(env, props, reservations);
    throw error;
  }
}

type JsonArrayScan = { depth: number; quoted: boolean; escaped: boolean };

function stringByte(state: JsonArrayScan, byte: number): void {
  if (state.escaped) state.escaped = false;
  else if (byte === 0x5c) state.escaped = true;
  else if (byte === 0x22) state.quoted = false;
}

function memberBoundary(state: JsonArrayScan, byte: number): boolean {
  if (state.quoted) {
    stringByte(state, byte);
    return false;
  }
  if (byte === 0x22) state.quoted = true;
  else if (byte === 0x7b || byte === 0x5b) state.depth++;
  else if (byte === 0x5d && state.depth === 0) return true;
  else if (byte === 0x7d || byte === 0x5d) state.depth--;
  return byte === 0x2c && state.depth === 0;
}

/** Slice an already parsed, bounded array at ASCII structural boundaries, preserving UTF-8 bytes. */
function retainedBatchBytes(
  bytes: Uint8Array,
  messages: (ToolRequest | Cancellation | undefined)[],
): Uint8Array {
  const spans: { start: number; end: number }[] = [];
  const state: JsonArrayScan = { depth: 0, quoted: false, escaped: false };
  let start = bytes.indexOf(0x5b) + 1;
  for (let index = start; index < bytes.length; index++) {
    if (!memberBoundary(state, bytes[index])) continue;
    spans.push({ start, end: index });
    start = index + 1;
    if (bytes[index] === 0x5d) break;
  }
  if (spans.length !== messages.length) throw new RequestFailure(400);
  const retained = spans.filter(
    (_, index) => messages[index]?.method !== 'notifications/cancelled',
  );
  const length =
    2 +
    retained.reduce((size, span) => size + span.end - span.start, 0) +
    Math.max(0, retained.length - 1);
  if (length > bytes.length) throw new RequestFailure(400);
  const body = new Uint8Array(length);
  body[0] = 0x5b;
  let offset = 1;
  for (const [index, span] of retained.entries()) {
    if (index) body[offset++] = 0x2c;
    body.set(bytes.subarray(span.start, span.end), offset);
    offset += span.end - span.start;
  }
  body[offset] = 0x5d;
  return body;
}

async function sdkRequest(
  request: Request,
  value: unknown,
  messages: (ToolRequest | Cancellation | undefined)[],
): Promise<Request> {
  if (
    !Array.isArray(value) ||
    !messages.some((message) => message?.method === 'notifications/cancelled')
  )
    return request;
  // Cancellation was applied to authenticated Durable Object associations. Replaying it
  // into the SDK's new stateless server can suppress a response and strand the batch stream.
  // The preceding bodyJson validates and bounds these same bytes before this read.
  const body = retainedBatchBytes(new Uint8Array(await request.clone().arrayBuffer()), messages);
  const headers = new Headers(request.headers);
  headers.delete('Content-Length');
  return new Request(request, { headers, body, signal: request.signal });
}

/** The provider verifies props/client identity before any cancellation association is derived. */
export async function prepareMcpExchange(
  request: Request,
  env: Env,
  props: OAuthGrantProps,
  scopes: RemoteScope,
  oauthClientId: string,
): Promise<McpExchange> {
  if (request.method !== 'POST' || !isJsonContentType(request.headers.get('Content-Type')))
    return {};
  const value = await bodyJson(request.clone());
  const batch = Array.isArray(value);
  if (
    batch &&
    (value.length === 0 ||
      value.length > 100 ||
      !(await isLegacyRequest(request, value, { maxRequestBodySize: MAX_BYTES })))
  )
    return {
      response: json(
        {
          error: 'invalid_request',
          error_description: 'MCP batches require 1 to 100 valid legacy JSON-RPC messages.',
        },
        400,
      ),
    };
  const messages = batch ? batchAssociations(value) : [messageAssociation(value)];
  const forwarded = await sdkRequest(request, value, messages);
  const reservations = await associateMessages(env, props, scopes, oauthClientId, messages);
  if (!batch && reservations.size && [...reservations.values()][0] === null)
    return { response: json({ error: 'unavailable' }, 503) };
  if (messages.every((message) => message?.method === 'notifications/cancelled'))
    return { response: new Response(null, { status: 202 }) };
  return { reservations, request: forwarded };
}
