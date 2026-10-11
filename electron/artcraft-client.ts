import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';

export interface ArtcraftEndpoint {
  port: number;
  /** PhotoCraft bearer token. VectorCraft v0.9.0 has no authentication. */
  token?: string;
  timeoutMs?: number;
}

const MAX_REPLY_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/** One request per connection; transport failures must never replay a possible edit. */
export async function artcraftRequest(
  endpoint: ArtcraftEndpoint,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const timeoutMs = validateEndpoint(endpoint);
  const requestId = randomUUID();
  const authId = randomUUID();
  const request = JSON.stringify({ id: requestId, method, params }) + '\n';
  if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) {
    throw new Error('ArtCraft request exceeds the control protocol size limit');
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: endpoint.port });
    let settled = false;
    let authenticating = endpoint.token !== undefined;
    let pending = Buffer.alloc(0);
    let received = 0;
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(
      () => finish(new Error('ArtCraft request timed out; the operation may have completed')),
      timeoutMs,
    );
    socket.setNoDelay(true);
    socket.on('connect', () => {
      socket.write(
        authenticating
          ? JSON.stringify({ id: authId, method: 'auth', params: { token: endpoint.token } }) + '\n'
          : request,
      );
    });
    socket.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_REPLY_BYTES) {
        finish(new Error('ArtCraft reply exceeds the control protocol size limit'));
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      while (!settled) {
        const newline = pending.indexOf(10);
        if (newline < 0) return;
        const line = pending.subarray(0, newline);
        pending = pending.subarray(newline + 1);
        let result: unknown;
        try {
          result = parseReply(line, authenticating ? authId : requestId, authenticating);
        } catch (error) {
          finish(error instanceof Error ? error : new Error('Invalid ArtCraft reply'));
          return;
        }
        if (authenticating) {
          authenticating = false;
          socket.write(request);
        } else {
          finish(undefined, result);
        }
      }
    });
    socket.on('error', () => {
      finish(new Error('ArtCraft control connection failed; the operation may have completed'));
    });
    socket.on('close', () => {
      finish(
        new Error(
          'ArtCraft control connection closed before replying; the operation may have completed',
        ),
      );
    });
  });
}

function parseReply(line: Buffer, expectedId: string, authenticating: boolean): unknown {
  let reply: unknown;
  try {
    reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
  } catch {
    throw new Error('ArtCraft returned an invalid JSON reply');
  }
  if (!isControlReply(reply) || reply.id !== expectedId) {
    throw new Error('ArtCraft returned an unexpected control reply');
  }
  if (!reply.ok) {
    const detail = typeof reply.error === 'string' ? reply.error : 'Request refused';
    throw new Error(authenticating ? 'ArtCraft authentication failed' : `ArtCraft: ${detail}`);
  }
  return reply.result;
}

function isControlReply(value: unknown): value is {
  id: unknown;
  ok: boolean;
  error?: unknown;
  result?: unknown;
} {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'id' in value &&
    'ok' in value &&
    typeof value.ok === 'boolean'
  );
}

function validateEndpoint(endpoint: ArtcraftEndpoint): number {
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) {
    throw new Error('Invalid ArtCraft control port');
  }
  // PhotoCraft 0.7.0 and VectorCraft 0.9.0 allow 60 seconds for replies.
  // Leave time for authentication/transport rather than abandoning a save early.
  const timeoutMs = endpoint.timeoutMs ?? 65_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid ArtCraft request timeout');
  }
  return timeoutMs;
}
