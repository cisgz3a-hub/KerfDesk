/* global TextDecoder */
export class ServiceError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function requireValue(condition, status = 400, code = 'invalid_request') {
  if (!condition) throw new ServiceError(status, code);
}

export function text(value, min = 1, max = 100) {
  requireValue(typeof value === 'string' && value.length >= min && value.length <= max);
  requireValue(
    !Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ),
  );
  return value;
}

export function identifier(value) {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(value));
  return value;
}

export function device(value) {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value));
  return value;
}

export function secret(value) {
  return device(value);
}

export async function readBody(request, limit = 16_384) {
  const length = request.headers.get('content-length');
  if (length !== null)
    requireValue(/^\d+$/u.test(length) && Number(length) <= limit, 413, 'body_too_large');
  requireValue(
    request.headers.get('content-type')?.split(';')[0].trim() === 'application/json',
    415,
    'json_required',
  );
  const reader = request.body?.getReader();
  requireValue(reader, 400, 'body_required');
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireValue(size <= limit, 413, 'body_too_large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ServiceError(400, 'invalid_json');
  }
}

export function parseBody(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ServiceError(400, 'invalid_json');
  }
  requireValue(body !== null && typeof body === 'object' && !Array.isArray(body));
  return body;
}
