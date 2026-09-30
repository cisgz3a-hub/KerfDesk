/* global URL, URLSearchParams, AbortSignal, TextDecoder */
export const LICENSING_ORIGIN = 'https://license.kerfdesk.com';

export function checkoutTransaction(search) {
  const params = new URLSearchParams(search);
  if ([...params.keys()].join(',') !== '_ptxn') return null;
  const value = params.get('_ptxn');
  return /^txn_[a-z0-9]{26}$/u.test(value ?? '') ? value : null;
}

export function checkoutConfiguration(value) {
  if (
    value?.enabled !== true ||
    value.provider !== 'paddle' ||
    !['sandbox', 'live'].includes(value.environment) ||
    typeof value.clientToken !== 'string'
  )
    return null;
  const prefix = value.environment === 'sandbox' ? 'test_' : 'live_';
  if (
    !value.clientToken.startsWith(prefix) ||
    !/^(test|live)_[a-zA-Z0-9]{27}$/u.test(value.clientToken)
  )
    return null;
  if (
    value.purchase?.amount !== 4950 ||
    value.purchase.currency !== 'USD' ||
    value.renewal?.amount !== 2000 ||
    value.renewal.currency !== 'USD'
  )
    return null;
  return { token: value.clientToken, environment: value.environment };
}

export async function licensingRequest(fetcher, path, body) {
  const response = await fetcher(`${LICENSING_ORIGIN}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(8000),
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const value = await boundedJson(response);
  if (!response.ok) {
    const error = new Error('Licence service request failed');
    error.code = typeof value?.error?.code === 'string' ? value.error.code : 'unavailable';
    throw error;
  }
  return value;
}

export async function publicConfig(fetcher) {
  return checkoutConfiguration(await licensingRequest(fetcher, '/v1/public/config'));
}

async function boundedJson(response) {
  if (!response.body) throw new Error('Licence service unavailable');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 4096) throw new Error('Invalid licence service response');
      parts.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function validBrowserOrder(order) {
  if (
    !order ||
    typeof order.orderId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/u.test(order.orderId) ||
    typeof order.claimToken !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/u.test(order.claimToken) ||
    order.amount !== 4950 ||
    order.currency !== 'USD' ||
    typeof order.checkoutUrl !== 'string'
  )
    return false;
  try {
    const url = new URL(order.checkoutUrl);
    return (
      url.origin === 'https://kerfdesk.com' &&
      url.pathname === '/buy.html' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      checkoutTransaction(url.search) !== null
    );
  } catch {
    return false;
  }
}

export function validClaim(value) {
  if (!value || typeof value.licenseId !== 'string' || typeof value.licenseKey !== 'string')
    return false;
  const key =
    /^KD1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/u.exec(
      value.licenseKey,
    );
  return key !== null && key[1] === value.licenseId;
}
