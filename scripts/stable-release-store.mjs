const API_BASE = 'https://api.cloudflare.com/client/v4';
const MAX_OBJECT_BYTES = 300_000_000;
const LIST_PAGE_SIZE = 1000;
const storageDiagnostics = new WeakMap();
const storageOperations = new Set(['configuration', 'bucket', 'list', 'read', 'write', 'object']);
const storageReasons = new Map([
  ['configuration', 'explicit account and API token are required'],
  ['request', 'request or transport error'],
  ['http', 'unexpected HTTP response'],
  ['json', 'invalid JSON response'],
  ['response', 'invalid provider response'],
  ['listing', 'invalid object listing'],
  ['pagination', 'invalid or incomplete listing pagination'],
  ['key', 'invalid object key or prefix'],
  ['limit', 'object listing exceeds size or page limit'],
  ['body', 'invalid object response'],
  ['size', 'object response exceeds size limit'],
  ['upload', 'invalid object upload'],
]);

// Never retain provider text, request URLs, credentials or an underlying error.
// The formatter also ignores mutable Error fields such as message and stack.
export class ReleaseStorageError extends Error {
  constructor(operation, reason, status) {
    const label = storageOperations.has(operation) ? operation : 'operation';
    const detail =
      reason === 'http' && Number.isInteger(status) && status >= 100 && status <= 599
        ? `HTTP ${status}`
        : (storageReasons.get(reason) ?? 'invalid provider response');
    const diagnostic = `Release storage ${label} failed: ${detail}.`;
    super(diagnostic);
    this.name = 'ReleaseStorageError';
    storageDiagnostics.set(this, diagnostic);
  }
}

export function printableStorageFailure(error) {
  return storageDiagnostics.get(error) ?? null;
}

// Retry the whole publication, not a delayed mutable-pointer write. The caller
// must re-read its expected latest state before attempting any further writes.
export class ReleaseRateLimitError extends ReleaseStorageError {
  constructor(header, now = Date.now(), operation) {
    super(operation, 'http', 429);
    const seconds = /^\d+$/u.test(header ?? '')
      ? Number(header)
      : (Date.parse(header) - now) / 1000;
    this.retryAfterMs = Math.max(
      60_000,
      Math.ceil((Number.isFinite(seconds) ? seconds : 300) * 1000),
    );
  }
}

// Documented Cloudflare object API, also used by Wrangler. Only HTTP 404
// represents absence, after bucket access itself has succeeded. Redirects and
// authentication/network/rate-limit/provider failures never become absence.
// https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/
export async function createStableReleaseStore({ accountId, apiToken, fetchRequest = fetch }) {
  if (
    !/^[0-9a-f]{32}$/u.test(accountId ?? '') ||
    typeof apiToken !== 'string' ||
    apiToken.trim() === ''
  ) {
    throw new ReleaseStorageError('configuration', 'configuration');
  }
  const bucketUrl = `${API_BASE}/accounts/${accountId}/r2/buckets/kerfdesk-downloads`;
  const request = async (url, init, operation) => {
    let response;
    try {
      response = await fetchRequest(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
        headers: { Authorization: `Bearer ${apiToken}`, ...init.headers },
      });
    } catch {
      throw new ReleaseStorageError(operation, 'request');
    }
    if (response.status === 429) {
      const retry = new ReleaseRateLimitError(
        response.headers.get('retry-after'),
        Date.now(),
        operation,
      );
      try {
        await response.body?.cancel();
      } catch {
        // Failure to discard a body must not replace the typed rate-limit error.
      }
      throw retry;
    }
    return response;
  };
  const bucket = await request(bucketUrl, { method: 'GET' }, 'bucket');
  if (bucket.status !== 200) throw new ReleaseStorageError('bucket', 'http', bucket.status);
  const bucketInfo = await readJsonResponse(bucket, 'bucket');
  if (bucketInfo?.success !== true || bucketInfo.result?.name !== 'kerfdesk-downloads') {
    throw new ReleaseStorageError('bucket', 'response');
  }
  return {
    async list(prefix) {
      if (typeof prefix !== 'string' || !prefix.endsWith('/'))
        throw new ReleaseStorageError('list', 'key');
      objectUrl(bucketUrl, prefix.slice(0, -1));
      const keys = new Set();
      const cursors = new Set();
      let cursor;
      let pageSize = LIST_PAGE_SIZE;
      for (;;) {
        const url = new URL(`${bucketUrl}/objects`);
        url.searchParams.set('prefix', prefix);
        url.searchParams.set('per_page', String(LIST_PAGE_SIZE));
        if (cursor !== undefined) url.searchParams.set('cursor', cursor);
        const response = await request(url.href, { method: 'GET' }, 'list');
        if (response.status !== 200) throw new ReleaseStorageError('list', 'http', response.status);
        let value;
        try {
          value = JSON.parse(
            (await readObjectBytes(response, 2 * 1024 * 1024, 'list')).toString('utf8'),
          );
        } catch (error) {
          if (error instanceof ReleaseStorageError) throw error;
          throw new ReleaseStorageError('list', 'json');
        }
        if (
          value?.success !== true ||
          !Array.isArray(value.result) ||
          value.result.length > LIST_PAGE_SIZE
        )
          throw new ReleaseStorageError('list', 'listing');
        const hasInfo = Object.hasOwn(value, 'result_info');
        const info = value.result_info;
        if (hasInfo) {
          if (
            !info ||
            typeof info !== 'object' ||
            Array.isArray(info) ||
            typeof info.is_truncated !== 'boolean'
          )
            throw new ReleaseStorageError('list', 'pagination');
          if (Object.hasOwn(info, 'per_page')) {
            if (
              !Number.isInteger(info.per_page) ||
              info.per_page < 1 ||
              info.per_page > LIST_PAGE_SIZE
            )
              throw new ReleaseStorageError('list', 'pagination');
            pageSize = info.per_page;
          }
          if (
            value.result.length > pageSize ||
            (Object.hasOwn(info, 'cursor') &&
              (typeof info.cursor !== 'string' || info.cursor.length > 8192))
          )
            throw new ReleaseStorageError('list', 'pagination');
        } else if (value.result.length >= pageSize) {
          // Cloudflare omits result_info on a short terminal page. A full page
          // without explicit completion could hide more history, so refuse it.
          throw new ReleaseStorageError('list', 'pagination');
        }
        for (const object of value.result) {
          if (
            typeof object?.key !== 'string' ||
            !object.key.startsWith(prefix) ||
            keys.has(object.key)
          )
            throw new ReleaseStorageError('list', 'key');
          objectUrl(bucketUrl, object.key);
          keys.add(object.key);
          if (keys.size > 4096) throw new ReleaseStorageError('list', 'limit');
        }
        if (!hasInfo || !info.is_truncated) return [...keys];
        cursor = info.cursor;
        if (
          typeof cursor !== 'string' ||
          !cursor ||
          cursor.length > 8192 ||
          cursors.has(cursor) ||
          cursors.size >= 16
        )
          throw new ReleaseStorageError('list', 'pagination');
        cursors.add(cursor);
      }
    },
    async get(key) {
      const response = await request(objectUrl(bucketUrl, key), { method: 'GET' }, 'read');
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (response.status !== 200) throw new ReleaseStorageError('read', 'http', response.status);
      return readObjectBytes(response);
    },
    async put(key, bytes, metadata) {
      if (!Buffer.isBuffer(bytes) || bytes.length > MAX_OBJECT_BYTES)
        throw new ReleaseStorageError('write', 'upload');
      const response = await request(
        objectUrl(bucketUrl, key),
        {
          method: 'PUT',
          body: bytes,
          headers: { 'Content-Type': metadata.contentType, 'Cache-Control': metadata.cacheControl },
        },
        'write',
      );
      if (response.status !== 200) throw new ReleaseStorageError('write', 'http', response.status);
      const result = await readJsonResponse(response, 'write');
      if (result?.success !== true) throw new ReleaseStorageError('write', 'response');
    },
  };
}

function objectUrl(bucketUrl, key) {
  if (
    !/^desktop\/[A-Za-z0-9_./-]+$/u.test(key) ||
    key.split('/').some((part) => part === '..' || part === '.' || part === '')
  ) {
    throw new ReleaseStorageError('object', 'key');
  }
  return `${bucketUrl}/objects/${key}`;
}

async function readJsonResponse(response, operation) {
  try {
    return await response.json();
  } catch {
    throw new ReleaseStorageError(operation, 'json');
  }
}

async function readObjectBytes(response, limit = MAX_OBJECT_BYTES, operation = 'read') {
  try {
    if (response.body === null) throw new ReleaseStorageError(operation, 'body');
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body.cancel();
      throw new ReleaseStorageError(operation, 'size');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ReleaseStorageError(operation, 'size');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    if (error instanceof ReleaseStorageError) throw error;
    throw new ReleaseStorageError(operation, 'body');
  }
}
