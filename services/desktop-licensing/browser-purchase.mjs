/* global Response */
import { ROUTE } from './routes.mjs';
import { requireValue } from './validation.mjs';

const ORIGIN = 'https://kerfdesk.com';
const PATHS = new Set([ROUTE.checkout, ROUTE.claim]);

// This is browser isolation, not authentication: the 256-bit claim credential
// still authorises key retrieval. Desktop main-process requests have no Origin.
export function browserPurchaseRequest(request, url) {
  return (
    url?.protocol === 'https:' &&
    !url.search &&
    PATHS.has(url.pathname) &&
    request.headers.get('origin') === ORIGIN
  );
}

export function requirePurchaseOrigin(request, url) {
  const browser = request.headers.has('origin');
  requireValue(!url.search && (!browser || browserPurchaseRequest(request, url)));
  if (browser) requireValue(!request.headers.has('authorization'));
  return browser;
}

export function browserPurchaseBody(path, body) {
  const keys = path === ROUTE.checkout ? ['requestId', 'operation'] : ['orderId', 'claimToken'];
  requireValue(
    Object.keys(body).length === keys.length && keys.every((key) => Object.hasOwn(body, key)),
  );
  if (path === ROUTE.checkout) requireValue(body.operation === 'purchase');
}

export function browserPurchasePreflight(request, url) {
  requireValue(browserPurchaseRequest(request, url));
  requireValue(request.headers.get('access-control-request-method') === 'POST');
  requireValue(
    request.headers.get('access-control-request-headers')?.trim().toLowerCase() === 'content-type',
  );
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'content-type',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

// Apply at the public edge, including rate-limit and configuration failures.
// There are no ambient credentials, wildcard origins or reflected header lists.
export function browserPurchaseResponse(request, url, response) {
  if (!browserPurchaseRequest(request, url)) return response;
  const answer = new Response(response.body, response);
  answer.headers.set('access-control-allow-origin', ORIGIN);
  answer.headers.append('vary', 'Origin');
  return answer;
}
