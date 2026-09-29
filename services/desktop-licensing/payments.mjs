import { nextUpdateYear } from './authority.mjs';
import { writeAudit } from './audit.mjs';
import { ROUTE } from './routes.mjs';
import { identifier, requireValue, secret } from './validation.mjs';

export const CATALOG = Object.freeze({ purchase: 4950, renewal: 2000 });

// Called only by authenticated administration or a future, reviewed checkout
// adapter. An order never grants access until an authenticated payment matches it.
export async function prepareOrder(authority, body, admin) {
  const orderId = identifier(body.orderId);
  const provider = identifier(body.provider);
  const providerOrderId = identifier(body.providerOrderId);
  requireValue(Object.hasOwn(CATALOG, body.operation));
  const licenseId =
    body.operation === 'renewal' ? identifier(body.licenseId) : authority.crypto.id();
  const expected = {
    orderId,
    provider,
    providerOrderId,
    operation: body.operation,
    amount: CATALOG[body.operation],
    currency: 'USD',
  };
  const claimToken = await authority.crypto.derive('order-claim', orderId);
  const claimTokenHash = await authority.crypto.hash('order-claim', claimToken);
  const order = authority.records.transaction((tx) => {
    const previous = tx.get(`order:${orderId}`);
    if (previous) {
      requireValue(
        Object.keys(expected).every((key) => previous[key] === expected[key]) &&
          (body.operation !== 'renewal' || previous.licenseId === licenseId),
        409,
        'idempotency_conflict',
      );
      writeAudit(tx, authority, admin, {
        route: ROUTE.orders,
        target: orderId,
        outcome: 'existing',
      });
      return previous;
    }
    requireValue(
      !tx.get(`provider-order:${provider}:${providerOrderId}`),
      409,
      'provider_order_reused',
    );
    if (body.operation === 'renewal')
      requireValue(
        tx.get(`license:${licenseId}`)?.tier === 'paid',
        409,
        'renewal_requires_paid_license',
      );
    const created = {
      ...expected,
      licenseId,
      claimTokenHash,
      status: 'pending',
      createdAt: authority.now(),
    };
    tx.put(`order:${orderId}`, created);
    tx.put(`provider-order:${provider}:${providerOrderId}`, { orderId });
    writeAudit(tx, authority, admin, { route: ROUTE.orders, target: orderId, outcome: 'created' });
    return created;
  });
  return { orderId, claimToken, amount: order.amount, currency: order.currency };
}

// This accepts only the normalized output of an authenticated provider adapter.
// Both event IDs and payment IDs are durable deduplication keys. All licence and
// event changes share one SQLite transaction, including update-year increments.
export async function fulfilVerifiedPayment(authority, event) {
  identifier(event.eventId);
  identifier(event.paymentId);
  identifier(event.orderId);
  identifier(event.provider);
  identifier(event.providerOrderId);
  requireValue(
    event.status === 'paid' && Number.isSafeInteger(event.amount),
    400,
    'invalid_payment',
  );
  const order = authority.records.get(`order:${event.orderId}`);
  requireValue(order, 409, 'unknown_order');
  if (order.orderProofHash)
    requireValue(
      typeof event.orderProof === 'string' &&
        (await authority.crypto.matches('order-proof', event.orderProof, order.orderProofHash)),
      409,
      'payment_mismatch',
    );
  const keyHash = await authority.crypto.hash(
    'license-key',
    await authority.licenseKey(order.licenseId),
  );
  const now = authority.now();
  return authority.records.transaction((tx) => {
    const current = tx.get(`order:${event.orderId}`);
    requireValue(
      ['provider', 'amount', 'currency'].every((key) => current[key] === event[key]) &&
        (!current.priceId || current.priceId === event.priceId),
      409,
      'payment_mismatch',
    );
    requireValue(
      !current.providerOrderId || current.providerOrderId === event.providerOrderId,
      409,
      'payment_mismatch',
    );
    const bound = tx.get(`provider-order:${event.provider}:${event.providerOrderId}`);
    requireValue(!bound || bound.orderId === event.orderId, 409, 'provider_order_reused');
    const identity = {
      orderId: event.orderId,
      paymentId: event.paymentId,
      providerOrderId: event.providerOrderId,
      amount: event.amount,
      currency: event.currency,
    };
    const eventKey = `payment-event:${event.provider}:${event.eventId}`;
    const previous = tx.get(eventKey);
    if (previous) {
      requireValue(
        JSON.stringify(previous) === JSON.stringify(identity),
        409,
        'idempotency_conflict',
      );
      return { received: true, duplicate: true };
    }
    const paymentKey = `payment:${event.provider}:${event.paymentId}`;
    const paid = tx.get(paymentKey);
    requireValue(!paid || paid.orderId === event.orderId, 409, 'payment_reused');
    if (current.status === 'fulfilled') {
      requireValue(current.paymentId === event.paymentId, 409, 'order_already_paid');
      tx.put(eventKey, identity);
      return { received: true, duplicate: true };
    }
    applyEntitlement(tx, current, now, keyHash);
    tx.put(paymentKey, { orderId: event.orderId });
    tx.put(eventKey, identity);
    tx.put(`provider-order:${event.provider}:${event.providerOrderId}`, { orderId: event.orderId });
    tx.put(`order:${event.orderId}`, {
      ...current,
      providerOrderId: event.providerOrderId,
      status: 'fulfilled',
      paymentId: event.paymentId,
      fulfilledAt: now,
    });
    return { received: true, duplicate: false };
  });
}

function applyEntitlement(tx, order, now, keyHash) {
  if (order.operation === 'purchase') {
    requireValue(!tx.get(`license:${order.licenseId}`), 409, 'license_already_exists');
    tx.put(`license:${order.licenseId}`, {
      licenseId: order.licenseId,
      tier: 'paid',
      status: 'active',
      issuedAt: now,
      accessExpiresAt: null,
      updatesUntil: nextUpdateYear(now),
      perpetualUpdates: false,
      keyHash,
      active: [],
    });
    return;
  }
  const license = tx.get(`license:${order.licenseId}`);
  requireValue(
    license?.tier === 'paid' && license.status === 'active',
    409,
    'renewal_requires_paid_license',
  );
  license.updatesUntil = nextUpdateYear(Math.max(now, license.updatesUntil));
  tx.put(`license:${license.licenseId}`, license);
}

export async function claimOrder(authority, body) {
  const order = authority.records.get(`order:${identifier(body.orderId)}`);
  requireValue(
    order &&
      (await authority.crypto.matches(
        'order-claim',
        secret(body.claimToken),
        order.claimTokenHash,
      )),
    401,
    'invalid_credentials',
  );
  // Paddle took the money but the service refused the payment and recorded why. The
  // buyer must not pay again; support refunds or reconciles it (ADR-523 Amendment 3).
  requireValue(order.status !== 'rejected', 409, 'payment_rejected');
  requireValue(order.status === 'fulfilled', 409, 'payment_pending');
  const license = authority.records.get(`license:${order.licenseId}`);
  return {
    licenseId: order.licenseId,
    licenseKey: await authority.licenseKey(order.licenseId, license?.keyVersion),
  };
}
