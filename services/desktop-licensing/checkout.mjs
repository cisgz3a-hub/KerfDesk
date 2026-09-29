import { CATALOG } from './payments.mjs';
import { createPaddleTransaction, paddleConfiguration } from './paddle.mjs';
import { requireValue, secret, ServiceError } from './validation.mjs';

// Answers after which nobody can pay the order: Paddle refused to create the
// transaction, or created one whose link this service will never hand out.
const FINAL_FAILURES = new Set(['checkout_failed', 'invalid_provider_response']);

export async function createCheckout(authority, env, body, fetcher) {
  const config = paddleConfiguration(env);
  requireValue(Object.hasOwn(CATALOG, body.operation));
  const requestHash = await authority.crypto.hash('checkout-request', secret(body.requestId));
  const license = body.operation === 'renewal' ? await renewalLicense(authority, body) : null;
  requireValue(!license || license.tier === 'paid', 409, 'renewal_requires_paid_license');
  const id = authority.crypto.id();
  const orderProof = await authority.crypto.derive('order-proof', id);
  const claimToken = await authority.crypto.derive('order-claim', id);
  const hashes = {
    orderProofHash: await authority.crypto.hash('order-proof', orderProof),
    claimTokenHash: await authority.crypto.hash('order-claim', claimToken),
  };
  const selected = authority.records.transaction((tx) => {
    const priorId = tx.get(`checkout-request:${requestHash}`)?.orderId;
    if (priorId) {
      const prior = tx.get(`order:${priorId}`);
      requireValue(
        prior.operation === body.operation && (!license || license.licenseId === prior.licenseId),
        409,
        'idempotency_conflict',
      );
      return { order: prior, created: false };
    }
    const order = {
      orderId: id,
      licenseId: license?.licenseId ?? authority.crypto.id(),
      operation: body.operation,
      provider: 'paddle',
      providerOrderId: null,
      priceId: config.prices[body.operation],
      amount: CATALOG[body.operation],
      currency: 'USD',
      ...hashes,
      status: 'pending',
      createdAt: authority.now(),
      checkoutUrl: null,
    };
    tx.put(`order:${id}`, order);
    tx.put(`checkout-request:${requestHash}`, { orderId: id });
    return { order, created: true };
  });
  if (!selected.created) {
    // A paid order whose checkout answer was lost still hands back its order, so the app
    // can claim it: a licence, or `payment_rejected` with the order number to quote.
    const paid = ['fulfilled', 'rejected'].includes(selected.order.status);
    if (!selected.order.checkoutUrl && paid && selected.order.providerOrderId) {
      selected.order.checkoutUrl = `${config.checkout}?_ptxn=${selected.order.providerOrderId}`;
    }
    requireValue(selected.order.checkoutUrl, 409, 'checkout_pending');
    return checkoutResult(authority, selected.order);
  }
  let result;
  try {
    result = await createPaddleTransaction(env, { ...selected.order, orderProof }, fetcher);
  } catch (error) {
    if (error instanceof ServiceError && FINAL_FAILURES.has(error.code))
      failOrder(authority, id, requestHash, error);
    throw error;
  }
  const attached = authority.records.transaction((tx) => {
    const order = tx.get(`order:${id}`);
    requireValue(
      !order.providerOrderId || order.providerOrderId === result.providerOrderId,
      409,
      'provider_order_reused',
    );
    const previous = tx.get(`provider-order:paddle:${result.providerOrderId}`);
    requireValue(!previous || previous.orderId === id, 409, 'provider_order_reused');
    const next = { ...order, ...result };
    tx.put(`order:${id}`, next);
    tx.put(`provider-order:paddle:${result.providerOrderId}`, { orderId: id });
    return next;
  });
  return checkoutResult(authority, attached);
}

/**
 * Marks an order nobody can pay as failed and frees its checkout request ID in one
 * transaction, so the same request ID starts a fresh order next time instead of
 * answering `checkout_pending` forever (ADR-523 Amendment 3).
 */
function failOrder(authority, orderId, requestHash, error) {
  try {
    authority.records.transaction((tx) => {
      const order = tx.get(`order:${orderId}`);
      if (order?.status !== 'pending') return;
      tx.put(`order:${orderId}`, {
        ...order,
        status: 'failed',
        failedAt: authority.now(),
        failure: { code: error.code, provider: error.provider ?? null },
      });
      if (tx.get(`checkout-request:${requestHash}`)?.orderId === orderId)
        tx.delete(`checkout-request:${requestHash}`);
    });
  } catch {
    /* The order then stays pending, as before; the caller still gets the refusal. */
  }
}

async function renewalLicense(authority, body) {
  if (body.licenseKey) return authority.authenticateLicense(body.licenseKey);
  const activation = await authority.authenticateActivation(body);
  const license = authority.records.get(`license:${activation.licenseId}`);
  requireValue(
    activation.active &&
      license?.active.includes(activation.activationId) &&
      license.status === 'active',
    403,
    'activation_inactive',
  );
  return license;
}

async function checkoutResult(authority, order) {
  return {
    orderId: order.orderId,
    claimToken: await authority.crypto.derive('order-claim', order.orderId),
    checkoutUrl: order.checkoutUrl,
    amount: order.amount,
    currency: order.currency,
  };
}
