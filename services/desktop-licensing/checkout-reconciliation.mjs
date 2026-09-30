/* global fetch, AbortSignal */
import { writeAudit } from './audit.mjs';
import { checkoutLink, paddleConfiguration, validatePaddleTransaction } from './paddle.mjs';
import { ROUTE } from './routes.mjs';
import { identifier, parseBody, readBody, requireValue, ServiceError } from './validation.mjs';

/**
 * Recover a lost checkout answer using an existing Paddle transaction, never by
 * creating another payable order. Only the authenticated admin route calls this.
 * Even a completed transaction is not fulfilled here: the signed webhook remains
 * the only payment authority. Its original claim/request credentials stay intact.
 */
export async function reconcileCheckout(authority, env, body, admin, fetcher = fetch) {
  requireValue(
    Object.keys(body).length === 2 &&
      Object.hasOwn(body, 'orderId') &&
      /^txn_[a-z0-9]{26}$/u.test(body.transactionId ?? ''),
  );
  const orderId = identifier(body.orderId);
  const order = authority.records.get(`order:${orderId}`);
  requireValue(order, 404, 'order_not_found');
  requirePendingOrder(order, body.transactionId);
  const config = paddleConfiguration(env);
  const data = await readTransaction(env, config, body.transactionId, fetcher);
  requireValue(
    data?.id === body.transactionId &&
      ['draft', 'ready', 'completed'].includes(data.status) &&
      data.custom_data?.kerfdesk_order_id === orderId &&
      data.custom_data?.kerfdesk_operation === order.operation &&
      typeof data.custom_data?.kerfdesk_order_proof === 'string' &&
      (await authority.crypto.matches(
        'order-proof',
        data.custom_data.kerfdesk_order_proof,
        order.orderProofHash,
      )),
    409,
    'payment_mismatch',
  );
  validatePaddleTransaction(data, config, order.operation);
  requireValue(data.items[0].price.id === order.priceId, 409, 'payment_mismatch');
  const checkoutUrl = checkoutLink(data, config);
  return authority.records.transaction((tx) => {
    // The provider request and proof check yielded. Re-read everything we change:
    // a webhook, deletion or another reconciliation may have won that interval.
    const current = tx.get(`order:${orderId}`);
    requireValue(current, 404, 'order_not_found');
    requirePendingOrder(current, data.id);
    requireValue(
      ['licenseId', 'operation', 'priceId', 'amount', 'currency', 'orderProofHash'].every(
        (key) => current[key] === order[key],
      ),
      409,
      'idempotency_conflict',
    );
    const binding = `provider-order:paddle:${data.id}`;
    const bound = tx.get(binding);
    requireValue(!bound || bound.orderId === orderId, 409, 'provider_order_reused');
    const existing = current.providerOrderId === data.id && current.checkoutUrl === checkoutUrl;
    tx.put(`order:${orderId}`, { ...current, providerOrderId: data.id, checkoutUrl });
    tx.put(binding, { orderId });
    writeAudit(tx, authority, admin, {
      route: ROUTE.reconcileOrder,
      target: orderId,
      outcome: existing ? 'existing' : 'reconciled',
      transactionId: data.id,
      providerStatus: data.status,
    });
    return { orderId, transactionId: data.id, orderStatus: current.status, reconciled: true };
  });
}

function requirePendingOrder(order, transactionId) {
  requireValue(
    order.status === 'pending' && order.provider === 'paddle' && order.orderProofHash,
    409,
    'order_not_pending',
  );
  requireValue(
    !order.providerOrderId || order.providerOrderId === transactionId,
    409,
    'provider_order_reused',
  );
}

async function readTransaction(env, config, transactionId, fetcher) {
  let response;
  try {
    response = await fetcher(`${config.api}/transactions/${transactionId}`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${env.PADDLE_API_KEY}`, 'paddle-version': '1' },
    });
  } catch {
    throw new ServiceError(502, 'reconciliation_unavailable');
  }
  // A missing transaction does not establish that this order has no transaction.
  // No answer, including 404 or a redirect, releases its checkout request ID.
  requireValue(response.status !== 404, 404, 'transaction_not_found');
  requireValue(response.ok, 502, 'reconciliation_unavailable');
  try {
    return parseBody(await readBody(response, 131_072)).data;
  } catch {
    throw new ServiceError(503, 'invalid_provider_response');
  }
}
