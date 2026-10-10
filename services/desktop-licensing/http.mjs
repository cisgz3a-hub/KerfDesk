/* global Response, URL */
import { deleteCustomer, exportRecords, rekeyLicense } from './admin.mjs';
import { auditRefusal } from './audit.mjs';
import { browserPurchaseBody, requirePurchaseOrigin } from './browser-purchase.mjs';
import { adminCredential } from './crypto.mjs';
import { createCheckout } from './checkout.mjs';
import { reconcileCheckout } from './checkout-reconciliation.mjs';
import { paddleVerifier } from './paddle.mjs';
import { receivePayment } from './payment-rejections.mjs';
import { emailLicenceKey } from './licence-email.mjs';
import { claimOrder, prepareOrder } from './payments.mjs';
import { ROUTE } from './routes.mjs';
import { parseBody, readBody, requireValue, ServiceError } from './validation.mjs';

// Set on a 503 caused by an unexpected error: the error's type only, never its
// message. The Worker copies it into the request's log line and removes it before
// answering (ADR-523 Amendment 3).
export const FAULT_HEADER = 'x-licensing-fault';

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
  if (error instanceof ServiceError) return json({ error: { code: error.code } }, error.status);
  const response = json({ error: { code: 'service_unavailable' } }, 503);
  const name = typeof error?.name === 'string' ? error.name : '';
  response.headers.set(FAULT_HEADER, /^[A-Za-z]{1,40}$/u.test(name) ? name : 'Error');
  return response;
}

const OPERATIONS = {
  [ROUTE.trial]: ({ authority, body }) => authority.startTrial(body),
  [ROUTE.activate]: ({ authority, body }) => authority.activate(body),
  [ROUTE.activations]: ({ authority, body }) => authority.listActivations(body),
  [ROUTE.releaseWithKey]: ({ authority, body }) => authority.releaseWithKey(body),
  [ROUTE.refresh]: ({ authority, body }) => authority.refresh(body),
  [ROUTE.deactivate]: ({ authority, body }) => authority.deactivate(body),
  [ROUTE.developerGrants]: ({ authority, body, admin }) => authority.developerGrant(body, admin),
  [ROUTE.orders]: ({ authority, body, admin }) => prepareOrder(authority, body, admin),
  [ROUTE.reconcileOrder]: ({ authority, env, body, admin, fetcher }) =>
    reconcileCheckout(authority, env, body, admin, fetcher),
  [ROUTE.licenseStatus]: ({ authority, body, admin }) => authority.setLicenseStatus(body, admin),
  [ROUTE.lookup]: ({ authority, body, admin }) => authority.lookupLicense(body, admin),
  [ROUTE.rekey]: ({ authority, body, admin }) => rekeyLicense(authority, body, admin),
  [ROUTE.export]: ({ authority, body, admin }) => exportRecords(authority, body, admin),
  [ROUTE.deleteCustomer]: ({ authority, body, admin }) => deleteCustomer(authority, body, admin),
  [ROUTE.claim]: ({ authority, body }) => claimOrder(authority, body),
  [ROUTE.checkout]: ({ authority, env, body, fetcher }) =>
    createCheckout(authority, env, body, fetcher),
};

async function paymentWebhook(request, env, authority, options) {
  const verifier = paddleVerifier(env);
  const raw = await readBody(request, 131_072);
  const event = await verifier(request.headers, raw, authority.now());
  requireValue(event, 401, 'invalid_payment_signature');
  if (event.ignored) return { received: true, ignored: true };
  const result = await receivePayment(authority, event);
  // Paddle needs its answer within five seconds; the key email follows the answer.
  const email = emailLicenceKey(authority, env, event, result, options.fetcher).catch(
    () => undefined,
  );
  if (options.waitUntil) options.waitUntil(email);
  else await email;
  return result;
}

export async function authorityRequest(request, env, authority, options = {}) {
  let admin = null;
  let body;
  let path;
  try {
    requireValue(env.LICENSING_ENABLED === 'true', 503, 'service_unavailable');
    const url = new URL(request.url);
    const browser = requirePurchaseOrigin(request, url);
    requireValue(request.method === 'POST', 405, 'method_not_allowed');
    path = url.pathname;
    if (path.startsWith('/v1/admin/')) {
      admin = await adminCredential(request.headers.get('authorization'), env);
      requireValue(admin, 401, 'invalid_credentials');
    }
    if (path === ROUTE.webhook) return json(await paymentWebhook(request, env, authority, options));
    body = parseBody(await readBody(request));
    if (browser) browserPurchaseBody(path, body);
    requireValue(Object.hasOwn(OPERATIONS, path), 404, 'not_found');
    const result = await OPERATIONS[path]({
      authority,
      env,
      body,
      admin,
      fetcher: options.fetcher,
    });
    return result instanceof Response ? result : json(result);
  } catch (error) {
    // An authenticated administrator's refused call is audited too (ADR-523 Amendment 3).
    if (admin && body !== undefined && error instanceof ServiceError && error.code !== 'not_found')
      auditRefusal(authority, admin, path, body, error.code);
    // Do not return/log exception text: validation and crypto errors can contain
    // request input. Only stable, non-sensitive codes cross this boundary.
    return failure(error);
  }
}
