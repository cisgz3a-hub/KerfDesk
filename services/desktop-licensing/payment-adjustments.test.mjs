/* global Headers */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { authorityRequest } from './http.mjs';
import { deleteCustomer } from './admin.mjs';
import { claimOrder } from './payments.mjs';
import {
  checkoutOrder,
  credentials,
  deviceId,
  fixture,
  NOW,
  paddleTransaction,
  signedPaddle,
  webhookRequest,
} from './test-support.mjs';

const TXN = `txn_${'c'.repeat(26)}`;
const OTHER_TXN = `txn_${'d'.repeat(26)}`;
const at = (offset) => new Date(NOW * 1000 + offset).toISOString();
let eventTime = 0;

function signedAdjustment(env, data, eventId, eventType = 'adjustment.created', occurredAt) {
  const raw = JSON.stringify({
    event_id: eventId,
    event_type: eventType,
    occurred_at: occurredAt ?? at(++eventTime),
    data,
  });
  const signature = createHmac('sha256', env.PADDLE_WEBHOOK_SECRET)
    .update(`${NOW}:${raw}`)
    .digest('hex');
  return { raw, headers: new Headers({ 'paddle-signature': `ts=${NOW};h1=${signature}` }) };
}

const adjustment = (overrides = {}) => ({
  id: `adj_${'a'.repeat(26)}`,
  action: 'refund',
  status: 'approved',
  type: 'full',
  transaction_id: TXN,
  created_at: at(0),
  ...overrides,
});

async function purchased() {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const send = async (signed) =>
    (await authorityRequest(webhookRequest(signed), f.env, f.authority)).json();
  const { checkout, intent } = await checkoutOrder(f, deviceId(30));
  await send(signedPaddle(f.env, paddleTransaction(f.env, intent), 'evt_paid'));
  const { licenseId, licenseKey } = await claimOrder(f.authority, checkout);
  const seat = credentials(
    await f.authority.activate({ licenseKey, deviceId: deviceId(1), deviceName: 'Workshop PC' }),
  );
  const adjust = (data, eventId, eventType, occurredAt) =>
    send(signedAdjustment(f.env, data, eventId, eventType, occurredAt));
  const status = () => f.records.get(`license:${licenseId}`).status;
  return { ...f, send, adjust, status, licenseId, licenseKey, seat };
}

test('an approved full refund revokes the licence and refuses the next refresh', async () => {
  const f = await purchased();
  const signed = signedAdjustment(f.env, adjustment(), 'evt_refund');
  assert.deepEqual(await f.send(signed), {
    received: true,
    adjustment: 'revoked',
  });
  assert.equal(f.status(), 'revoked');
  await assert.rejects(f.authority.refresh(f.seat), { code: 'license_revoked' });
  // Paddle redelivers: nothing changes and nothing new is recorded.
  assert.deepEqual(await f.send(signed), {
    received: true,
    duplicate: true,
  });
});

test('a refund before completion is retained and cannot create claimable rights later', async () => {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const { checkout, intent } = await checkoutOrder(f, deviceId(30));
  const refund = signedAdjustment(f.env, adjustment(), 'evt_early_refund');
  const response = await authorityRequest(webhookRequest(refund), f.env, f.authority);
  assert.equal((await response.json()).adjustment, 'deferred');
  assert.equal(
    f.records.get(`license:${f.records.get(`order:${checkout.orderId}`).licenseId}`),
    undefined,
  );
  const paid = signedPaddle(f.env, paddleTransaction(f.env, intent), 'evt_late_paid');
  const completed = await authorityRequest(webhookRequest(paid), f.env, f.authority);
  assert.equal(completed.status, 200);
  await assert.rejects(claimOrder(f.authority, checkout), { code: 'license_revoked' });
  // A different completed event ID for the same transaction cannot resurrect it.
  const replay = signedPaddle(f.env, paddleTransaction(f.env, intent), 'evt_new_paid');
  await authorityRequest(webhookRequest(replay), f.env, f.authority);
  await assert.rejects(claimOrder(f.authority, checkout), { code: 'license_revoked' });
});

test('an unbound refund also survives a lost checkout response until completion proves the order', async () => {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const { checkout, intent } = await checkoutOrder(f, deviceId(30));
  f.records.delete(`provider-order:paddle:${TXN}`);
  const order = f.records.get(`order:${checkout.orderId}`);
  delete order.providerOrderId;
  f.records.put(`order:${checkout.orderId}`, order);
  const response = await authorityRequest(
    webhookRequest(signedAdjustment(f.env, adjustment(), 'evt_unbound_refund')),
    f.env,
    f.authority,
  );
  assert.deepEqual(await response.json(), { received: true, ignored: true });
  await authorityRequest(
    webhookRequest(signedPaddle(f.env, paddleTransaction(f.env, intent), 'evt_bound_late')),
    f.env,
    f.authority,
  );
  await assert.rejects(claimOrder(f.authority, checkout), { code: 'license_revoked' });
});

test('a refunded rejected payment creates no rights, even after its completion is corrected', async () => {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const { checkout, intent } = await checkoutOrder(f, deviceId(30));
  const data = paddleTransaction(f.env, intent);
  const bad = { ...data, discount_id: 'dsc_refused' };
  await authorityRequest(
    webhookRequest(signedPaddle(f.env, bad, 'evt_refused')),
    f.env,
    f.authority,
  );
  const order = f.records.get(`order:${checkout.orderId}`);
  assert.equal(order.status, 'rejected');
  await authorityRequest(
    webhookRequest(signedAdjustment(f.env, adjustment(), 'evt_rejected_refund')),
    f.env,
    f.authority,
  );
  assert.equal(f.records.get(`license:${order.licenseId}`), undefined);
  await assert.rejects(claimOrder(f.authority, checkout), { code: 'payment_rejected' });
  await authorityRequest(
    webhookRequest(signedPaddle(f.env, data, 'evt_corrected')),
    f.env,
    f.authority,
  );
  await assert.rejects(claimOrder(f.authority, checkout), { code: 'license_revoked' });
});

test('a revoked order claim discloses no key, including revocation during key derivation', async () => {
  const f = await purchased();
  const order = f.records.get(`provider-order:paddle:${TXN}`);
  const claimToken = await f.authority.crypto.derive('order-claim', order.orderId);
  const body = { ...order, claimToken };
  const derive = f.authority.licenseKey.bind(f.authority);
  f.authority.licenseKey = async (...args) => {
    const key = await derive(...args);
    await f.authority.setLicenseStatus({ licenseId: f.licenseId, status: 'revoked' });
    return key;
  };
  await assert.rejects(claimOrder(f.authority, body), { code: 'license_revoked' });
  await assert.rejects(claimOrder(f.authority, body), { code: 'license_revoked' });
});

test('a refund waiting for Paddle approval changes nothing until adjustment.updated approves it', async () => {
  const f = await purchased();
  const pending = adjustment({ status: 'pending_approval' });
  assert.equal((await f.adjust(pending, 'evt_pending')).adjustment, 'none');
  assert.equal(f.status(), 'active');
  const rejected = adjustment({ status: 'rejected' });
  assert.equal((await f.adjust(rejected, 'evt_rejected', 'adjustment.updated')).adjustment, 'none');
  assert.equal(f.status(), 'active');
  assert.equal(
    (await f.adjust(adjustment(), 'evt_approved', 'adjustment.updated')).adjustment,
    'revoked',
  );
  assert.equal(f.status(), 'revoked');
});

test('approval wins when a pending creation has the same provider timestamp', async () => {
  const f = await purchased();
  await f.adjust(
    adjustment({ status: 'pending_approval' }),
    'evt_equal_pending',
    'adjustment.created',
    at(1000),
  );
  await f.adjust(adjustment(), 'evt_equal_approved', 'adjustment.updated', at(1000));
  assert.equal(f.status(), 'revoked');
  await f.adjust(
    adjustment({ status: 'pending_approval' }),
    'evt_equal_stale',
    'adjustment.created',
    at(1000),
  );
  assert.equal(f.records.get(`payment-adjustment:paddle:adj_${'a'.repeat(26)}`).status, 'approved');
});

test('a partial refund, such as a tax refund, is kept for support and does not revoke', async () => {
  const f = await purchased();
  assert.equal(
    (await f.adjust(adjustment({ type: 'partial' }), 'evt_partial')).adjustment,
    'review',
  );
  assert.equal(f.status(), 'active');
  assert.equal(f.records.get(`payment-adjustment:paddle:adj_${'a'.repeat(26)}`).outcome, 'review');
});

test('a chargeback revokes and its reversal restores, but a reversal never undoes a refund', async () => {
  const f = await purchased();
  const chargeback = adjustment({ id: `adj_${'b'.repeat(26)}`, action: 'chargeback' });
  assert.equal((await f.adjust(chargeback, 'evt_cb')).adjustment, 'revoked');
  const reverse = adjustment({ id: `adj_${'c'.repeat(26)}`, action: 'chargeback_reverse' });
  assert.equal((await f.adjust(reverse, 'evt_cb_reverse')).adjustment, 'restored');
  assert.equal(f.status(), 'active');
  assert.ok((await f.authority.refresh(f.seat)).entitlement);

  assert.equal((await f.adjust(adjustment(), 'evt_refund')).adjustment, 'revoked');
  const late = adjustment({ id: `adj_${'d'.repeat(26)}`, action: 'chargeback_warning_reverse' });
  assert.equal((await f.adjust(late, 'evt_late')).adjustment, 'none');
  assert.equal(f.status(), 'revoked');
});

test('a refund received while chargeback-revoked survives a later reversal', async () => {
  const f = await purchased();
  await f.adjust(adjustment({ action: 'chargeback', id: 'adj_cb' }), 'evt_cb');
  await f.adjust(adjustment(), 'evt_refund_after_cb');
  const reversed = await f.adjust(
    adjustment({ action: 'chargeback_reverse', id: 'adj_reverse' }),
    'evt_reverse_after_refund',
  );
  assert.equal(reversed.adjustment, 'none');
  assert.equal(f.status(), 'revoked');
  await assert.rejects(f.authority.refresh(f.seat), { code: 'license_revoked' });
});

test('a reversal delivered before its chargeback prevents a stale revocation', async () => {
  const f = await purchased();
  await f.adjust(
    adjustment({ action: 'chargeback_reverse', id: 'adj_reverse', created_at: at(2000) }),
    'evt_reverse_first',
    'adjustment.created',
    at(2000),
  );
  await f.adjust(
    adjustment({ action: 'chargeback', id: 'adj_cb', created_at: at(1000) }),
    'evt_cb_late',
    'adjustment.created',
    at(1000),
  );
  assert.equal(f.status(), 'active');
  assert.ok((await f.authority.refresh(f.seat)).entitlement);
});

test('a chargeback reversal never restores an outstanding warning or a later chargeback', async () => {
  const f = await purchased();
  await f.adjust(adjustment({ action: 'chargeback_warning', id: 'adj_warning' }), 'evt_warning');
  await f.adjust(adjustment({ action: 'chargeback', id: 'adj_cb' }), 'evt_cb');
  await f.adjust(adjustment({ action: 'chargeback_reverse', id: 'adj_reverse' }), 'evt_reverse');
  assert.equal(f.status(), 'revoked');
  await f.adjust(
    adjustment({ action: 'chargeback_warning_reverse', id: 'adj_warning_reverse' }),
    'evt_warning_reverse',
  );
  assert.equal(f.status(), 'active');
  await f.adjust(
    adjustment({ action: 'chargeback', id: 'adj_cb_new', created_at: at(3000) }),
    'evt_cb_new',
    'adjustment.created',
    at(3000),
  );
  assert.equal(f.status(), 'revoked');
});

test('a reversed chargeback update wins over an older approved delivery', async () => {
  const f = await purchased();
  const cb = adjustment({ action: 'chargeback', id: 'adj_cb' });
  await f.adjust(cb, 'evt_cb', 'adjustment.created', at(1000));
  await f.adjust({ ...cb, status: 'reversed' }, 'evt_cb_reversed', 'adjustment.updated', at(3000));
  assert.equal(f.status(), 'active');
  await f.adjust(cb, 'evt_cb_stale', 'adjustment.updated', at(2000));
  assert.equal(f.status(), 'active');
});

test('a support revocation is not restored by a chargeback reversal', async () => {
  const f = await purchased();
  const chargeback = adjustment({ id: `adj_${'b'.repeat(26)}`, action: 'chargeback' });
  assert.equal((await f.adjust(chargeback, 'evt_cb')).adjustment, 'revoked');
  // Support restores, then later revokes for another reason (a leaked key, say).
  await f.authority.setLicenseStatus({ licenseId: f.licenseId, status: 'active' });
  await f.authority.setLicenseStatus({ licenseId: f.licenseId, status: 'revoked' });
  const reverse = adjustment({ action: 'chargeback_reverse' });
  assert.equal((await f.adjust(reverse, 'evt_reverse')).adjustment, 'none');
  assert.equal(f.status(), 'revoked');
});

test('a same-state update cannot undo a support restoration', async () => {
  const f = await purchased();
  const cb = adjustment({ action: 'chargeback', id: 'adj_cb' });
  await f.adjust(cb, 'evt_cb');
  await f.authority.setLicenseStatus({ licenseId: f.licenseId, status: 'active' });
  await f.adjust(cb, 'evt_cb_same_state', 'adjustment.updated');
  assert.equal(f.status(), 'active');
});

test('an adjustment event ID or entity ID cannot be rebound to another transaction', async () => {
  const f = await purchased();
  const signed = signedAdjustment(
    f.env,
    adjustment(),
    'evt_refund',
    'adjustment.created',
    at(1000),
  );
  await f.send(signed);
  const differentEvent = await f.adjust(
    adjustment({ transaction_id: OTHER_TXN }),
    'evt_refund',
    'adjustment.created',
    at(1000),
  );
  assert.equal(differentEvent.error.code, 'idempotency_conflict');
  const differentEntity = await f.adjust(adjustment({ transaction_id: OTHER_TXN }), 'evt_other');
  assert.equal(differentEntity.error.code, 'idempotency_conflict');
  assert.equal(f.status(), 'revoked');
});

test('revocation, deduplication and adjustment audit roll back together on failure', async () => {
  const f = await purchased();
  const put = f.records.put.bind(f.records);
  f.records.put = (key, value) => {
    if (key.startsWith('audit:')) throw new Error('test write failure');
    return put(key, value);
  };
  const signed = signedAdjustment(f.env, adjustment(), 'evt_refund');
  assert.equal((await f.send(signed)).error.code, 'service_unavailable');
  assert.equal(f.status(), 'active');
  assert.equal(f.records.get('adjustment-event:paddle:evt_refund'), undefined);
  f.records.put = put;
  assert.equal((await f.send(signed)).adjustment, 'revoked');
});

test('customer deletion removes adjustment state and every linked delivery record', async () => {
  const f = await purchased();
  await f.adjust(adjustment({ status: 'pending_approval' }), 'evt_pending');
  await f.adjust(adjustment(), 'evt_refund', 'adjustment.updated');
  deleteCustomer(f.authority, { licenseId: f.licenseId });
  assert.equal(f.records.keysWhere('payment-adjustment:', 'transactionId', TXN).length, 0);
  assert.equal(f.records.keysWhere('adjustment-event:', 'transactionId', TXN).length, 0);
});

test('a refunded renewal is kept for support and leaves the paid licence active', async () => {
  const f = await purchased();
  const renewal = await checkoutOrder(
    f,
    deviceId(31),
    { operation: 'renewal', licenseKey: f.licenseKey },
    OTHER_TXN,
  );
  await f.send(
    signedPaddle(f.env, paddleTransaction(f.env, renewal.intent, { id: OTHER_TXN }), 'evt_renew'),
  );
  const refund = adjustment({ transaction_id: OTHER_TXN });
  assert.equal((await f.adjust(refund, 'evt_renew_refund')).adjustment, 'review');
  assert.equal(f.status(), 'active');
});

test('adjustments to transactions KerfDesk never fulfilled are acknowledged and ignored', async () => {
  const f = await purchased();
  const foreign = adjustment({ transaction_id: `txn_${'e'.repeat(26)}` });
  assert.deepEqual(await f.adjust(foreign, 'evt_foreign'), { received: true, ignored: true });
  assert.deepEqual(await f.adjust({ id: 'adj_x' }, 'evt_malformed'), {
    received: true,
    ignored: true,
  });
  assert.equal(f.status(), 'active');
});
