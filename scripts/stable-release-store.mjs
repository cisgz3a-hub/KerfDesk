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

async function readObjectBytes(response) {
  if (response.body === null) throw new Error('Invalid stable R2 object response.');
  if (Number(response.headers.get('content-length')) > MAX_OBJECT_BYTES) {
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
    if (size > MAX_OBJECT_BYTES) {
      await reader.cancel();
      throw new Error('Stable R2 object response exceeds the size limit.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}
