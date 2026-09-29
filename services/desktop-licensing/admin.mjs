/* global Response */
import { writeAudit } from './audit.mjs';
import { ROUTE } from './routes.mjs';
import { identifier, requireValue, text } from './validation.mjs';

// Private administration beyond grants and status changes: support lookups, rekeying
// a leaked licence key, a backup export and deleting one customer's records
// (ADR-523 Amendment 3). Every call is audited.

const LOOKUP_FIELDS = ['licenseId', 'orderId', 'transactionId'];

/**
 * Finds a licence by its ID, an order by its number, or a Paddle transaction by its
 * `txn_` ID, so support can resend a lost key or see why a payment was refused.
 */
export async function lookup(authority, body, admin) {
  const keys = Object.keys(body);
  requireValue(keys.length === 1 && LOOKUP_FIELDS.includes(keys[0]));
  const target = identifier(body[keys[0]]);
  let result;
  if (keys[0] === 'licenseId') result = await licenceSummary(authority, target);
  else if (keys[0] === 'orderId') result = await orderSummary(authority, target);
  else result = await transactionSummary(authority, target);
  // A lookup can disclose a licence key, so it is recorded like a change.
  authority.records.transaction((tx) =>
    writeAudit(tx, authority, admin, {
      route: ROUTE.lookup,
      target,
      outcome: result.licenseKey ? 'key-disclosed' : 'found',
    }),
  );
  return result;
}

async function licenceSummary(authority, licenseId) {
  const license = authority.records.get(`license:${licenseId}`);
  requireValue(license && license.tier !== 'trial', 404, 'license_not_found');
  return {
    licenseId,
    licenseKey: await authority.licenseKey(licenseId, license.keyVersion),
    keyVersion: license.keyVersion ?? 0,
    tier: license.tier,
    status: license.status,
    updatesUntil: license.updatesUntil,
    activeDevices: license.active.length,
  };
}

async function orderSummary(authority, orderId) {
  const order = authority.records.get(`order:${orderId}`);
  requireValue(order, 404, 'order_not_found');
  const summary = {
    orderId,
    operation: order.operation,
    orderStatus: order.status,
    createdAt: order.createdAt,
  };
  if (order.status === 'fulfilled')
    return { ...summary, ...(await licenceSummary(authority, order.licenseId)) };
  if (order.status === 'failed') return { ...summary, failure: order.failure ?? null };
  if (order.status === 'rejected') {
    const stored = authority.records.get(
      `payment-rejected:${order.provider}:${order.rejection?.transactionId}`,
    );
    return { ...summary, rejection: stored ?? order.rejection ?? null };
  }
  return summary;
}

async function transactionSummary(authority, transactionId) {
  const rejection = authority.records.get(`payment-rejected:paddle:${transactionId}`) ?? null;
  const orderId =
    authority.records.get(`provider-order:paddle:${transactionId}`)?.orderId ?? rejection?.orderId;
  requireValue(orderId, 404, 'order_not_found');
  if (!authority.records.get(`order:${orderId}`)) {
    // A refused payment for an order this service does not hold (a wrong environment
    // or a restored database) is still found by its transaction.
    requireValue(rejection, 404, 'order_not_found');
    return { transactionId, orderId, orderStatus: null, rejection };
  }
  const summary = await orderSummary(authority, orderId);
  return { transactionId, ...summary, ...(rejection ? { rejection } : {}) };
}

/**
 * Replaces a licence's key after a leak. The licence moves to the next key version, so
 * the old key stops activating at once; the new key is returned in this answer (and the
 * lookup can reproduce it later). `releaseSeats: true` also frees every seat without
 * counting toward the six-moves cap, so devices using the leaked key lose their seat at
 * their next check.
 */
export async function rekeyLicense(authority, body, admin) {
  const licenseId = identifier(body.licenseId);
  requireValue(body.releaseSeats === undefined || typeof body.releaseSeats === 'boolean');
  const license = authority.records.get(`license:${licenseId}`);
  requireValue(license && license.tier !== 'trial', 404, 'license_not_found');
  const keyVersion = (license.keyVersion ?? 0) + 1;
  const licenseKey = await authority.licenseKey(licenseId, keyVersion);
  const keyHash = await authority.crypto.hash('license-key', licenseKey);
  const releasedSeats = authority.records.transaction((tx) => {
    const current = tx.get(`license:${licenseId}`);
    requireValue(current, 404, 'license_not_found');
    // Another rekey won the race; the operator repeats the request for a fresh key.
    requireValue((current.keyVersion ?? 0) === keyVersion - 1, 409, 'idempotency_conflict');
    const freed = body.releaseSeats === true ? current.active : [];
    for (const activationId of freed) {
      const activation = tx.get(`activation:${activationId}`);
      if (activation) tx.put(`activation:${activationId}`, { ...activation, active: false });
    }
    // Support's releases are not added to `releases`, so they never use up the cap.
    tx.put(`license:${licenseId}`, {
      ...current,
      active: freed.length ? [] : current.active,
      keyVersion,
      keyHash,
    });
    writeAudit(tx, authority, admin, {
      route: ROUTE.rekey,
      target: licenseId,
      outcome: 'rekeyed',
      keyVersion,
      releasedSeats: freed.length,
    });
    return freed.length;
  });
  return { licenseId, licenseKey, keyVersion, releasedSeats };
}

const EXPORT_PAGE = 1000;
const EXPORT_PAGE_MAX = 5000;

/**
 * One page of every stored record as JSON Lines, for an offline backup. The first
 * line says how many records follow and the key to pass as `after` for the next page
 * (null on the last). The store holds no licence keys, tokens or other secrets, only
 * their HMACs, so neither does the export. Each page is one consistent read; pages
 * taken while the service runs can differ in time.
 */
export function exportRecords(authority, body, admin) {
  requireValue(Object.keys(body).every((key) => key === 'after' || key === 'limit'));
  const after = body.after === undefined ? '' : text(body.after, 1, 300);
  const limit = body.limit ?? EXPORT_PAGE;
  requireValue(Number.isSafeInteger(limit) && limit >= 1 && limit <= EXPORT_PAGE_MAX);
  const lines = authority.records.transaction((tx) => {
    const rows = tx.page(after, limit + 1);
    const records = rows.slice(0, limit);
    const next = rows.length > limit ? records.at(-1).key : null;
    writeAudit(tx, authority, admin, {
      route: ROUTE.export,
      target: null,
      outcome: 'exported',
      after: after || null,
      count: records.length,
    });
    const header = {
      format: 'kerfdesk-licensing-export',
      version: 1,
      exportedAt: authority.now(),
      count: records.length,
      next,
    };
    return [header, ...records].map((line) => JSON.stringify(line));
  });
  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

// Records that point at an order by its `orderId` field.
const ORDER_RECORDS = [
  'checkout-request:',
  'provider-order:',
  'payment:',
  'payment-event:',
  'payment-rejected:',
];

/**
 * Deletes one customer's records on request: a licence (by ID, or by the number of an
 * order for it) with its seats, grant, orders and their payment records. A paid or
 * developer licence must be revoked first, so a slip cannot erase one in use. Audit
 * records stay, including this deletion's.
 */
export function deleteCustomer(authority, body, admin) {
  const keys = Object.keys(body);
  requireValue(keys.length === 1 && ['licenseId', 'orderId'].includes(keys[0]));
  return authority.records.transaction((tx) => {
    let licenseId;
    if (keys[0] === 'licenseId') licenseId = identifier(body.licenseId);
    else {
      const order = tx.get(`order:${identifier(body.orderId)}`);
      requireValue(order, 404, 'order_not_found');
      licenseId = order.licenseId;
    }
    const license = tx.get(`license:${licenseId}`);
    requireValue(
      !license || license.tier === 'trial' || license.status === 'revoked',
      409,
      'license_not_revoked',
    );
    const orders = tx.keysWhere('order:', 'licenseId', licenseId);
    requireValue(license || orders.length, 404, 'license_not_found');
    const doomed = new Set([
      ...(license ? [`license:${licenseId}`] : []),
      ...tx.keysWhere('activation:', 'licenseId', licenseId),
      ...tx.keysWhere('grant:', 'licenseId', licenseId),
      ...orders,
    ]);
    for (const order of orders) {
      const orderId = order.slice('order:'.length);
      for (const prefix of ORDER_RECORDS)
        for (const key of tx.keysWhere(prefix, 'orderId', orderId)) doomed.add(key);
    }
    for (const key of doomed) tx.delete(key);
    writeAudit(tx, authority, admin, {
      route: ROUTE.deleteCustomer,
      target: licenseId,
      outcome: 'deleted',
      deletedRecords: doomed.size,
    });
    return { licenseId, deletedRecords: doomed.size };
  });
}
