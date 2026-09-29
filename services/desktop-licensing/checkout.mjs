import { CATALOG } from './payments.mjs';
import { createPaddleTransaction, paddleConfiguration } from './paddle.mjs';
import { requireValue, secret } from './validation.mjs';

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
    if (!selected.order.checkoutUrl && selected.order.status === 'fulfilled') {
      selected.order.checkoutUrl = `${config.checkout}?_ptxn=${selected.order.providerOrderId}`;
    }
    requireValue(selected.order.checkoutUrl, 409, 'checkout_pending');
    return checkoutResult(authority, selected.order);
  }
  const result = await createPaddleTransaction(env, { ...selected.order, orderProof }, fetcher);
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
