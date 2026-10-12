import { writeAudit } from './audit.mjs';
import { ROUTE } from './routes.mjs';
import { fullPurchaseRefund, refundItemFacts } from './payment-refund.mjs';
import { identifier, requireValue } from './validation.mjs';

// Paddle reports refunds and chargebacks as adjustments to the paid transaction.
// An approved full refund, a chargeback or a chargeback warning revokes the licence
// that transaction bought; a reversed chargeback restores a licence that chargeback
// revoked. Devices lose Pro at their next online refresh (ADR-592).

const REVOKING = new Set(['refund', 'chargeback', 'chargeback_warning']);
const RESTORING = new Set(['chargeback_reverse', 'chargeback_warning_reverse']);
const CHARGEBACKS = new Set(['chargeback', 'chargeback_warning']);
const REVERSE = {
  chargeback: 'chargeback_reverse',
  chargeback_warning: 'chargeback_warning_reverse',
};
const ADJUSTMENT_EVENTS = new Set(['adjustment.created', 'adjustment.updated']);
const TRANSACTION = /^txn_[a-z0-9]{26}$/u;
const SHORT = /^[a-z_]{1,40}$/u;
const STATUS_ORDER = new Map([
  ['pending_approval', 0],
  ['approved', 1],
  ['rejected', 1],
  ['reversed', 2],
]);

function timestamp(value) {
  requireValue(typeof value === 'string' && Number.isFinite(Date.parse(value)));
  return Date.parse(value);
}

export function isAdjustmentEvent(event) {
  return ADJUSTMENT_EVENTS.has(event?.event_type);
}

/** The normalized facts of an authenticated adjustment event, or `ignored`. */
export function paddleAdjustment(event) {
  const data = event.data;
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof data.transaction_id !== 'string' ||
    !TRANSACTION.test(data.transaction_id)
  )
    return { ignored: true };
  const short = (value) => (typeof value === 'string' && SHORT.test(value) ? value : null);
  return {
    adjustment: {
      eventId: identifier(event.event_id),
      adjustmentId: identifier(data.id),
      transactionId: data.transaction_id,
      action: short(data.action),
      status: short(data.status),
      type: short(data.type),
      refundItem: data.action === 'refund' ? refundItemFacts(data) : null,
      createdAt: timestamp(data.created_at),
      occurredAt: timestamp(event.occurred_at),
    },
  };
}

/** What an adjustment does to the licence its transaction bought. */
export function adjustmentEffect(adjustment, order) {
  const { action, status } = adjustment;
  if (status === 'reversed' && CHARGEBACKS.has(action)) return 'restore';
  if (status !== 'approved') return null;
  if (action === 'refund') return fullPurchaseRefund(adjustment, order) ? 'revoke' : 'review';
  if (REVOKING.has(action)) return 'revoke';
  if (RESTORING.has(action)) return 'restore';
  return null;
}

function sameEventIdentity(previous, adjustment) {
  const current = { ...adjustment };
  // Existing deliveries predate retained item facts. Their identity still proves
  // the same event; redelivery must preserve deduplication and support overrides.
  if (!Object.hasOwn(previous, 'refundItem')) delete current.refundItem;
  else if (
    previous.refundItem &&
    !Object.hasOwn(previous.refundItem, 'amount') &&
    current.refundItem
  ) {
    current.refundItem = { ...current.refundItem };
    delete current.refundItem.amount;
  }
  return JSON.stringify(previous) === JSON.stringify(current);
}

function supportStatusAfter(tx, licenseId, approvedAt) {
  // Audits use seconds, so a decision in the approval's second wins conservatively.
  const since = Math.floor(approvedAt / 1000);
  return tx.keysWhere('audit:', 'target', licenseId).some((key) => {
    const audit = tx.get(key);
    return (
      audit.route === ROUTE.licenseStatus &&
      typeof audit.credential === 'string' &&
      ['active', 'revoked'].includes(audit.outcome) &&
      audit.at >= since
    );
  });
}

function reviewedRefundReplay(tx, previousEvent, previous, adjustment, order) {
  if (!previousEvent || Object.hasOwn(previousEvent.identity, 'refundItem')) return false;
  if (previous?.outcome !== 'review' || Object.hasOwn(previous, 'refundItem')) return false;
  if (order?.status !== 'fulfilled' || order.operation !== 'purchase') return false;
  if (previous.occurredAt !== adjustment.occurredAt || previous.status !== 'approved') return false;
  return (
    adjustment.action === 'refund' &&
    adjustment.status === 'approved' &&
    fullPurchaseRefund(adjustment, order) &&
    !supportStatusAfter(tx, order.licenseId, previous.approvedAt ?? previous.occurredAt)
  );
}

/** Bind retained notifications only after this transaction has proved its order. */
function transactionAdjustments(tx, order, transactionId) {
  return tx.keysWhere('payment-adjustment:', 'transactionId', transactionId).map((key) => {
    const adjustment = tx.get(key);
    if (adjustment.orderId !== order.orderId || adjustment.licenseId !== order.licenseId) {
      adjustment.orderId = order.orderId;
      adjustment.licenseId = order.licenseId;
      tx.put(key, adjustment);
    }
    return adjustment;
  });
}

/** Apply all known payment facts in the same transaction as fulfilment/revocation. */
export function applyPurchaseAdjustments(tx, authority, order, transactionId, effect = 'both') {
  const adjustments = transactionAdjustments(tx, order, transactionId);
  if (order.operation !== 'purchase' || order.provider !== 'paddle') return 'review';
  const license = tx.get(`license:${order.licenseId}`);
  if (license?.tier !== 'paid') return 'none';
  const blocking = adjustments.filter((item) => {
    if (item.approvedAt === undefined) return false;
    if (item.action === 'refund') return fullPurchaseRefund(item, order);
    if (!CHARGEBACKS.has(item.action) || item.status === 'reversed') return false;
    return !adjustments.some(
      (reverse) =>
        reverse.action === REVERSE[item.action] &&
        reverse.status === 'approved' &&
        reverse.createdAt >= item.createdAt,
    );
  });
  // A full refund stays authoritative even if another adjustment first revoked Pro.
  const cause = blocking.find((item) => item.action === 'refund') ?? blocking[0];
  if (cause && effect !== 'restore') {
    if (license.status !== 'active' && license.revokedBy?.transactionId !== transactionId)
      return 'none';
    tx.put(`license:${license.licenseId}`, {
      ...license,
      status: 'revoked',
      revokedBy: {
        adjustmentId: cause.adjustmentId,
        transactionId,
        action: cause.action,
        at: authority.now(),
      },
    });
    if (license.status === 'active')
      tx.put(`payment-adjustment:paddle:${cause.adjustmentId}`, { ...cause, outcome: 'revoked' });
    return license.status === 'active' ? 'revoked' : 'none';
  }
  if (
    !cause &&
    effect !== 'revoke' &&
    license.status === 'revoked' &&
    license.revokedBy?.transactionId === transactionId &&
    CHARGEBACKS.has(license.revokedBy.action)
  ) {
    const restored = { ...license, status: 'active' };
    delete restored.revokedBy;
    tx.put(`license:${license.licenseId}`, restored);
    return 'restored';
  }
  return 'none';
}

export function receiveAdjustment(authority, adjustment) {
  const now = authority.now();
  return authority.records.transaction((tx) => {
    const eventKey = `adjustment-event:paddle:${adjustment.eventId}`;
    const previousEvent = tx.get(eventKey);
    if (previousEvent) {
      requireValue(
        sameEventIdentity(previousEvent.identity, adjustment),
        409,
        'idempotency_conflict',
      );
    }
    const orderId = tx.get(`provider-order:paddle:${adjustment.transactionId}`)?.orderId;
    const order = orderId === undefined ? undefined : tx.get(`order:${orderId}`);
    const owned =
      order?.provider === 'paddle' && order.providerOrderId === adjustment.transactionId;
    const recordKey = `payment-adjustment:paddle:${adjustment.adjustmentId}`;
    const previous = tx.get(recordKey);
    const enrich = reviewedRefundReplay(
      tx,
      previousEvent,
      previous,
      adjustment,
      owned ? order : undefined,
    );
    if (previousEvent && !enrich) return { received: true, duplicate: true };
    if (previous)
      requireValue(
        ['transactionId', 'action', 'type', 'createdAt'].every(
          (field) => previous[field] === adjustment[field],
        ),
        409,
        'idempotency_conflict',
      );
    tx.put(eventKey, {
      identity: adjustment,
      transactionId: adjustment.transactionId,
      ...(owned ? { orderId } : {}),
    });
    if (
      previous &&
      !enrich &&
      (previous.occurredAt > adjustment.occurredAt ||
        (previous.occurredAt === adjustment.occurredAt &&
          (STATUS_ORDER.get(previous.status) ?? -1) >= (STATUS_ORDER.get(adjustment.status) ?? -1)))
    )
      return { received: true, duplicate: true };
    const effect = adjustmentEffect(adjustment, owned ? order : undefined);
    const record = {
      ...adjustment,
      ...(owned ? { orderId, licenseId: order.licenseId } : {}),
      ...(previous?.approvedAt !== undefined
        ? { approvedAt: previous.approvedAt }
        : adjustment.status === 'approved'
          ? { approvedAt: adjustment.occurredAt }
          : {}),
      outcome: 'none',
      at: now,
    };
    tx.put(recordKey, record);
    // Retain even an unbound notification: Paddle may deliver a refund before the
    // original completion or before a lost checkout response has been reconciled.
    if (!owned) return { received: true, ignored: true };
    let outcome = 'none';
    if (effect !== null && (order.operation !== 'purchase' || effect === 'review'))
      outcome = 'review';
    else if (effect !== null && (previous?.status !== adjustment.status || enrich)) {
      if (order.status !== 'fulfilled') outcome = 'deferred';
      else
        outcome = applyPurchaseAdjustments(tx, authority, order, adjustment.transactionId, effect);
    }
    tx.put(recordKey, { ...record, outcome });
    if (outcome !== 'none')
      writeAudit(tx, authority, null, {
        route: ROUTE.webhook,
        target: order.licenseId,
        outcome: `adjustment-${outcome}`,
        adjustmentId: adjustment.adjustmentId,
      });
    return { received: true, adjustment: outcome };
  });
}
