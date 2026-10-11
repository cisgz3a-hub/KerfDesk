const API_BASE = 'https://api.cloudflare.com/client/v4';
const MAX_OBJECT_BYTES = 300_000_000;

// Retry the whole publication, not a delayed mutable-pointer write. The caller
// must re-read its expected latest state before attempting any further writes.
export class ReleaseRateLimitError extends Error {
  constructor(header, now = Date.now()) {
    super('Release storage is rate limited: HTTP 429.');
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
    throw new Error('Stable R2 account and API token are required.');
  }
  const bucketUrl = `${API_BASE}/accounts/${accountId}/r2/buckets/kerfdesk-downloads`;
  const request = async (url, init) => {
    const response = await fetchRequest(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${apiToken}`, ...init.headers },
    });
    if (response.status === 429) {
      const retry = new ReleaseRateLimitError(response.headers.get('retry-after'));
      await response.body?.cancel();
      throw retry;
    }
    return response;
  };
  const bucket = await request(bucketUrl, { method: 'GET' });
  if (bucket.status !== 200)
    throw new Error(`Stable R2 bucket access failed: HTTP ${bucket.status}.`);
  const bucketInfo = await bucket.json();
  if (bucketInfo.success !== true || bucketInfo.result?.name !== 'kerfdesk-downloads') {
    throw new Error('Stable R2 bucket response is invalid.');
  }
  return {
    async list(prefix) {
      if (typeof prefix !== 'string' || !prefix.endsWith('/'))
        throw new Error('Invalid stable release object prefix.');
      objectUrl(bucketUrl, prefix.slice(0, -1));
      const keys = new Set();
      const cursors = new Set();
      let cursor;
      for (;;) {
        const url = new URL(`${bucketUrl}/objects`);
        url.searchParams.set('prefix', prefix);
        url.searchParams.set('per_page', '1000');
        if (cursor !== undefined) url.searchParams.set('cursor', cursor);
        const response = await request(url.href, { method: 'GET' });
        if (response.status !== 200)
          throw new Error(`Stable R2 list failed: HTTP ${response.status}.`);
        const value = JSON.parse(
          (await readObjectBytes(response, 2 * 1024 * 1024)).toString('utf8'),
        );
        if (
          value.success !== true ||
          !Array.isArray(value.result) ||
          value.result.length > 1000 ||
          typeof value.result_info?.is_truncated !== 'boolean'
        )
          throw new Error('Invalid stable R2 object listing.');
        for (const object of value.result) {
          if (
            typeof object?.key !== 'string' ||
            !object.key.startsWith(prefix) ||
            keys.has(object.key)
          )
            throw new Error('Invalid stable R2 listed object key.');
          objectUrl(bucketUrl, object.key);
          keys.add(object.key);
          if (keys.size > 4096) throw new Error('Stable R2 object listing exceeds the size limit.');
        }
        if (!value.result_info.is_truncated) return [...keys];
        cursor = value.result_info.cursor;
        if (
          typeof cursor !== 'string' ||
          !cursor ||
          cursor.length > 8192 ||
          cursors.has(cursor) ||
          cursors.size >= 16
        )
          throw new Error('Invalid stable R2 listing cursor.');
        cursors.add(cursor);
      }
    },
    async get(key) {
      const response = await request(objectUrl(bucketUrl, key), { method: 'GET' });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (response.status !== 200)
        throw new Error(`Stable R2 read failed for ${key}: HTTP ${response.status}.`);
      return readObjectBytes(response);
    },
    async put(key, bytes, metadata) {
      if (!Buffer.isBuffer(bytes) || bytes.length > MAX_OBJECT_BYTES)
        throw new Error('Stable R2 object exceeds the REST upload limit.');
      const response = await request(objectUrl(bucketUrl, key), {
        method: 'PUT',
        body: bytes,
        headers: { 'Content-Type': metadata.contentType, 'Cache-Control': metadata.cacheControl },
      });
      if (response.status !== 200)
        throw new Error(`Stable R2 write failed for ${key}: HTTP ${response.status}.`);
      const result = await response.json();
      if (result.success !== true) throw new Error(`Stable R2 write was not confirmed for ${key}.`);
    },
  };
}

function objectUrl(bucketUrl, key) {
  if (
    !/^desktop\/[A-Za-z0-9_./-]+$/u.test(key) ||
    key.split('/').some((part) => part === '..' || part === '.' || part === '')
  ) {
    throw new Error('Invalid stable release object key.');
  }
  return `${bucketUrl}/objects/${key}`;
}

async function readObjectBytes(response, limit = MAX_OBJECT_BYTES) {
  if (response.body === null) throw new Error('Invalid stable R2 object response.');
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new Error('Invalid stable R2 object response.');
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
      throw new Error('Stable R2 object response exceeds the size limit.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}
