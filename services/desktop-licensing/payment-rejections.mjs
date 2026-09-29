import { fulfilVerifiedPayment } from './payments.mjs';
import { ServiceError } from './validation.mjs';

// A verified payment the service refuses is recorded and acknowledged, never bounced:
// a refusal made Paddle retry forever while the buyer, already charged, saw "payment
// pending" forever (ADR-523 Amendment 3). These are the refusals that are final for
// that payment; anything else (a malformed event, an outage) still fails so Paddle
// retries it.
export const REJECTION_CODES = new Set([
  'payment_not_completed',
  'payment_mismatch',
  'unknown_order',
  'order_already_paid',
  'license_already_exists',
  'renewal_requires_paid_license',
  'provider_order_reused',
  'payment_reused',
]);

/**
 * Fulfils a verified KerfDesk payment, or records why it cannot. A redelivery is
 * checked again, so after support fixes the cause (a revoked licence restored, say),
 * replaying the event from Paddle fulfils it; an unchanged refusal records nothing new.
 */
export async function receivePayment(authority, event) {
  if (event.rejection) return rejectPayment(authority, event, event.rejection);
  try {
    return await fulfilVerifiedPayment(authority, event);
  } catch (error) {
    if (!(error instanceof ServiceError) || !REJECTION_CODES.has(error.code)) throw error;
    return rejectPayment(authority, event, error.code);
  }
}

/** Whether the event carries this order's own proof (or, for an operator order, none). */
async function provenForOrder(authority, order, event) {
  if (!order) return false;
  // An operator-recorded order has no proof; its bound transaction ID identifies it.
  if (!order.orderProofHash) return true;
  return (
    typeof event.orderProof === 'string' &&
    (await authority.crypto.matches('order-proof', event.orderProof, order.orderProofHash))
  );
}

async function rejectPayment(authority, event, code) {
  const proven = await provenForOrder(
    authority,
    authority.records.get(`order:${event.orderId}`),
    event,
  );
  const now = authority.now();
  const transactionId = event.providerOrderId;
  return authority.records.transaction((tx) => {
    const order = tx.get(`order:${event.orderId}`);
    // A replay of the payment that already fulfilled this order changes nothing.
    if (order?.status === 'fulfilled' && order.paymentId === event.paymentId)
      return { received: true, duplicate: true };
    const key = `payment-rejected:${event.provider}:${transactionId}`;
    if (tx.get(key)) return { received: true, rejected: true, duplicate: true };
    tx.put(key, {
      transactionId,
      orderId: event.orderId,
      eventId: event.eventId,
      operation: event.operation ?? null,
      code,
      totals: event.facts ?? null,
      at: now,
    });
    // Only the order's own transaction marks it: a payment that merely names the order
    // (no matching proof, or bound to another transaction) must not block its claim.
    const binding = `provider-order:${event.provider}:${transactionId}`;
    const bound = tx.get(binding);
    const owned =
      proven &&
      order !== undefined &&
      (order.providerOrderId ?? transactionId) === transactionId &&
      (!bound || bound.orderId === event.orderId);
    if (owned && order.status !== 'fulfilled' && order.status !== 'rejected') {
      tx.put(`order:${event.orderId}`, {
        ...order,
        providerOrderId: transactionId,
        status: 'rejected',
        rejectedAt: now,
        rejection: { code, transactionId },
      });
      if (!bound) tx.put(binding, { orderId: event.orderId });
    }
    return { received: true, rejected: true, duplicate: false };
  });
}
