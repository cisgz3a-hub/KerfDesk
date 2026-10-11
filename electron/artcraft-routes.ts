import { trustedAppRequest } from './app-route-guard.js';
import type { ProtocolHandler } from './licensing-routes.js';
import { record, type ArtcraftOpen, type ArtcraftRuntime } from './artcraft-types.js';

export const ARTCRAFT_ROUTE = '/api/artcraft-studio';
const MAX_BODY = 48 * 1024 * 1024;
const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function withArtcraftRoutes(
  fallback: ProtocolHandler,
  runtime: ArtcraftRuntime,
): ProtocolHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== ARTCRAFT_ROUTE) return fallback(request);
    if (!trustedAppRequest(request, url, 'X-KerfDesk-Studio')) {
      return reply(404, { error: 'Not found' });
    }
    try {
      if (request.method === 'GET') return reply(200, await runtime.status());
      if (request.method !== 'POST' || request.headers.get('Content-Type') !== 'application/json') {
        return reply(404, { error: 'Not found' });
      }
      return reply(200, await dispatch(await readBody(request), runtime));
    } catch (error) {
      return reply(400, {
        error: error instanceof Error ? error.message : 'Desktop editor failed',
      });
    }
  };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (reader === undefined) throw new Error('Missing request');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new Error('Artwork is too large for this prototype');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

async function dispatch(
  input: Record<string, unknown>,
  runtime: ArtcraftRuntime,
): Promise<unknown> {
  switch (input['action']) {
    case 'open':
      return runtime.open(openInput(input));
    case 'snapshot':
      return runtime.snapshot(sessionId(input['sessionId']));
    case 'resume':
      return runtime.resume(sessionId(input['sessionId']));
    default:
      throw new Error('Unknown studio action');
  }
}
function sessionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value))
    throw new Error('Invalid studio session');
  return value;
}
function openInput(input: Record<string, unknown>): ArtcraftOpen {
  const editor = input['editor'];
  if (editor !== 'photo' && editor !== 'vector') throw new Error('Unknown editor');
  const result: ArtcraftOpen = { editor };
  for (const key of ['widthMm', 'heightMm'] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 2000) {
      throw new Error('Studio dimensions must be between 0 and 2000 mm');
    }
    result[key] = value;
  }
  if (input['source'] !== undefined) result.source = sourceInput(input['source']);
  return result;
}
function reply(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers });
}

function sourceInput(value: unknown): NonNullable<ArtcraftOpen['source']> {
  const source = record(value);
  const name = source['name'],
    dataBase64 = source['dataBase64'],
    mediaType = source['mediaType'];
  if (
    typeof name !== 'string' ||
    name.length > 240 ||
    typeof dataBase64 !== 'string' ||
    typeof mediaType !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)
  )
    throw new Error('Invalid artwork upload');
  return { name, dataBase64, mediaType };
}
