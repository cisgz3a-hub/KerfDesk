/* global Response, URL */
import { authenticateAdmin } from './crypto.mjs';
import { createCheckout } from './checkout.mjs';
import { paddleVerifier } from './paddle.mjs';
import { claimOrder, fulfilVerifiedPayment, prepareOrder } from './payments.mjs';
import { parseBody, readBody, requireValue, ServiceError } from './validation.mjs';

export function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

export function failure(error) {
  return error instanceof ServiceError
    ? json({ error: { code: error.code } }, error.status)
    : json({ error: { code: 'service_unavailable' } }, 503);
}

export async function authorityRequest(request, env, authority, options = {}) {
  try {
    requireValue(env.LICENSING_ENABLED === 'true', 503, 'service_unavailable');
    const url = new URL(request.url);
    requireValue(!url.search && !request.headers.has('origin'), 400, 'invalid_request');
    requireValue(request.method === 'POST', 405, 'method_not_allowed');
    const path = url.pathname;
    if (path.startsWith('/v1/admin/')) {
      requireValue(
        await authenticateAdmin(request.headers.get('authorization'), env.ADMIN_TOKEN),
        401,
        'invalid_credentials',
      );
    }
    if (path === '/v1/payments/webhook') {
      const verifier = paddleVerifier(env);
      const raw = await readBody(request, 131_072);
      const event = await verifier(request.headers, raw, authority.now());
      requireValue(event, 401, 'invalid_payment_signature');
      if (event.ignored) return json({ received: true, ignored: true });
      return json(await fulfilVerifiedPayment(authority, event));
    }
    const body = parseBody(await readBody(request));
    const operations = {
      '/v1/trials/start': () => authority.startTrial(body),
      '/v1/licenses/activate': () => authority.activate(body),
      '/v1/licenses/activations': () => authority.listActivations(body),
      '/v1/licenses/deactivate': () => authority.releaseWithKey(body),
      '/v1/activations/refresh': () => authority.refresh(body),
      '/v1/activations/deactivate': () => authority.deactivate(body),
      '/v1/admin/developer-grants': () => authority.developerGrant(body),
      '/v1/admin/orders': () => prepareOrder(authority, body),
      '/v1/orders/claim': () => claimOrder(authority, body),
      '/v1/checkout': () => createCheckout(authority, env, body, options.fetcher),
    };
    requireValue(Object.hasOwn(operations, path), 404, 'not_found');
    return json(await operations[path]());
  } catch (error) {
    // Do not return/log exception text: validation and crypto errors can contain
    // request input. Only stable, non-sensitive codes cross this boundary.
    return failure(error);
  }
}
