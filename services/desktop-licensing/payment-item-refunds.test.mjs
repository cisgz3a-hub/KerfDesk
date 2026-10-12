/* global Headers, structuredClone */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { authorityRequest } from './http.mjs';
import { claimOrder } from './payments.mjs';
import {
  adminRequest,
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
const ITEM = `txnitm_${'d'.repeat(26)}`;
const at = (offset) => new Date(NOW * 1000 + offset).toISOString();

function itemRefund() {
  return {
    id: `adj_${'a'.repeat(26)}`,
    action: 'refund',
    status: 'approved',
    // Omitting type when creating an adjustment defaults to partial, even when
    // every item is fully refunded (Paddle's pre-December-2024 API contract).
    type: 'partial',
    transaction_id: TXN,
    created_at: at(0),
    currency_code: 'USD',
    totals: { subtotal: '4950', tax: '200', total: '5150', currency_code: 'USD' },
    items: [
      {
        item_id: ITEM,
        type: 'full',
        totals: { subtotal: '4950', tax: '200', total: '5150' },
      },
    ],
  };
}

async function legacyReviewedRefund(f, data, eventId = 'evt_item_refund', offset = 1, occurredAt) {
  // The old normalizer retained neither items nor totals. Recreate that stored
  // review using the same event metadata that Paddle will authenticate on replay.
  const legacyData = { ...data };
  delete legacyData.items;
  assert.equal((await f.adjust(legacyData, eventId, offset, occurredAt)).adjustment, 'review');
  const eventKey = `adjustment-event:paddle:${eventId}`;
  const event = f.records.get(eventKey);
  delete event.identity.refundItem;
  f.records.put(eventKey, event);
  const recordKey = `payment-adjustment:paddle:${data.id}`;
  const record = f.records.get(recordKey);
  delete record.refundItem;
  f.records.put(recordKey, record);
}

function signedAdjustment(env, data, eventId, offset = 1, occurredAt = at(offset)) {
  const raw = JSON.stringify({
    event_id: eventId,
    event_type: offset === 1 ? 'adjustment.created' : 'adjustment.updated',
    occurred_at: occurredAt,
    data,
  });
  const signature = createHmac('sha256', env.PADDLE_WEBHOOK_SECRET)
    .update(`${NOW}:${raw}`)
    .digest('hex');
  return { raw, headers: new Headers({ 'paddle-signature': `ts=${NOW};h1=${signature}` }) };
}

async function purchase(complete = true, transactionId = TXN) {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const { checkout, intent } = await checkoutOrder(
    f,
    deviceId(30),
    { operation: 'purchase' },
    transactionId,
  );
  const send = async (signed) => {
    const response = await authorityRequest(webhookRequest(signed), f.env, f.authority);
    assert.equal(response.status, 200);
    return response.json();
  };
  const finish = () =>
    send(signedPaddle(f.env, paddleTransaction(f.env, intent, { id: transactionId }), 'evt_paid'));
  if (complete) await finish();
  const licenseId = f.records.get(`order:${checkout.orderId}`).licenseId;
  return {
    ...f,
    checkout,
    finish,
    licenseId,
    status: () => f.records.get(`license:${licenseId}`)?.status,
    adjust: (data, eventId = 'evt_item_refund', offset = 1, occurredAt) =>
      send(signedAdjustment(f.env, data, eventId, offset, occurredAt)),
  };
}

test('a full refund of the sole item revokes existing purchases with no stored item snapshot', async () => {
  const f = await purchase();
  const { licenseKey } = await claimOrder(f.authority, f.checkout);
  const seat = credentials(
    await f.authority.activate({ licenseKey, deviceId: deviceId(1), deviceName: 'Workshop' }),
  );
  assert.equal((await f.adjust(itemRefund())).adjustment, 'revoked');
  assert.equal(f.status(), 'revoked');
  await assert.rejects(f.authority.refresh(seat), { code: 'license_revoked' });
  await assert.rejects(claimOrder(f.authority, f.checkout), { code: 'license_revoked' });
  const reverse = {
    ...itemRefund(),
    id: `adj_${'b'.repeat(26)}`,
    action: 'chargeback_reverse',
    created_at: at(2),
  };
  await f.adjust(reverse, 'evt_unrelated_reverse', 2);
  assert.equal(f.status(), 'revoked');
});

test('a genuine partial or tax-only refund remains a support decision', async () => {
  for (const type of ['partial', 'tax']) {
    const f = await purchase();
    const data = itemRefund();
    data.items[0].type = type;
    data.totals = { subtotal: '0', tax: '200', total: '200', currency_code: 'USD' };
    data.items[0].totals = { subtotal: '0', tax: '200', total: '200' };
    assert.equal((await f.adjust(data)).adjustment, 'review');
    assert.equal(f.status(), 'active');
  }
});

test('inconsistent item, currency, amount and optional catalogue facts cannot revoke', async () => {
  const changes = [
    (data) => {
      data.items[0].item_id = 'txnitm_invalid';
    },
    (data) => {
      data.items.push(structuredClone(data.items[0]));
    },
    (data) => {
      data.currency_code = 'EUR';
    },
    (data) => {
      data.totals.currency_code = 'EUR';
    },
    (data) => {
      data.items[0].totals.subtotal = '4949';
    },
    (data) => {
      data.items[0].totals.tax = '199';
    },
    (data) => {
      data.items[0].totals.total = '5149';
    },
    (data) => {
      data.totals.total = '5151';
      data.items[0].totals.total = '5151';
    },
    (data) => {
      data.totals.subtotal = '2000';
      data.items[0].totals.subtotal = '2000';
    },
    (data) => {
      data.totals.tax = '-1';
      data.items[0].totals.tax = '-1';
    },
    (data) => {
      data.totals.total = '9007199254740992';
    },
    (data) => {
      delete data.items[0].totals;
    },
    (data) => {
      data.items[0].price_id = `pri_${'z'.repeat(26)}`;
    },
    (data) => {
      data.items[0].quantity = 2;
    },
  ];
  for (const change of changes) {
    const f = await purchase();
    const data = itemRefund();
    change(data);
    assert.equal((await f.adjust(data)).adjustment, 'review', change.toString());
    assert.equal(f.status(), 'active', change.toString());
  }
});

test('a full-item refund received before completion cannot produce claimable rights', async () => {
  for (const unbound of [false, true]) {
    const f = await purchase(false);
    if (unbound) {
      f.records.delete(`provider-order:paddle:${TXN}`);
      const order = f.records.get(`order:${f.checkout.orderId}`);
      delete order.providerOrderId;
      f.records.put(`order:${order.orderId}`, order);
    }
    const result = await f.adjust(itemRefund());
    assert.equal(unbound ? result.ignored : result.adjustment, unbound ? true : 'deferred');
    assert.equal(f.status(), undefined);
    await f.finish();
    assert.equal(f.status(), 'revoked');
    await assert.rejects(claimOrder(f.authority, f.checkout), { code: 'license_revoked' });
  }
});

test('full-item refunds follow approval and preserve support restoration on same-state updates', async () => {
  const f = await purchase();
  const data = itemRefund();
  data.items[0].price_id = f.env.PADDLE_PURCHASE_PRICE_ID;
  data.items[0].quantity = 1;
  await f.adjust({ ...data, status: 'pending_approval' });
  assert.equal(f.status(), 'active');
  assert.equal((await f.adjust(data, 'evt_item_approved', 2)).adjustment, 'revoked');
  await f.authority.setLicenseStatus({ licenseId: f.licenseId, status: 'active' });
  await f.adjust(data, 'evt_item_same_state', 3);
  assert.equal(f.status(), 'active');
});

test('deliveries recorded before item facts were retained still deduplicate after upgrade', async () => {
  const f = await purchase();
  const data = itemRefund();
  await f.adjust(data);
  await f.authority.setLicenseStatus({ licenseId: f.licenseId, status: 'active' });
  const key = 'adjustment-event:paddle:evt_item_refund';
  const legacy = f.records.get(key);
  delete legacy.identity.refundItem;
  f.records.put(key, legacy);
  assert.deepEqual(await f.adjust(data), { received: true, duplicate: true });
  assert.equal(f.status(), 'active');
});

test('a dashboard partial-item adjustment refunding the entire purchase revokes', async () => {
  // Paddle accepts tax-inclusive and external-tax amounts. Exact item and
  // aggregate financial totals must still prove the entire purchase was returned.
  for (const amount of ['5150', '4950']) {
    const f = await purchase();
    const data = itemRefund();
    data.items[0].type = 'partial';
    data.items[0].amount = amount;
    assert.equal((await f.adjust(data)).adjustment, 'revoked');
    assert.equal(f.status(), 'revoked');
  }
});

test('contradictory or malformed optional item amounts cannot revoke', async () => {
  for (const amount of ['100', '-1', '5.15', '9007199254740992']) {
    const f = await purchase();
    const data = itemRefund();
    data.items[0].type = 'partial';
    data.items[0].amount = amount;
    assert.equal((await f.adjust(data)).adjustment, 'review');
    assert.equal(f.status(), 'active');
  }
});

test('a legacy reviewed full-money refund is enriched once by its authenticated replay', async () => {
  const f = await purchase();
  const data = itemRefund();
  data.items[0].type = 'partial';
  data.items[0].amount = '5150';
  await legacyReviewedRefund(f, data);
  assert.equal(f.status(), 'active');
  assert.equal((await f.adjust(data)).adjustment, 'revoked');
  assert.equal(f.status(), 'revoked');
  await assert.rejects(claimOrder(f.authority, f.checkout), { code: 'license_revoked' });
  assert.equal(f.records.get(`payment-adjustment:paddle:${data.id}`).refundItem.itemTotal, 5150);
  assert.deepEqual(await f.adjust(data), { received: true, duplicate: true });
});

test('an authenticated support status after a legacy refund prevents replay enrichment', async () => {
  for (const status of ['active', 'revoked']) {
    const f = await purchase();
    const data = itemRefund();
    await legacyReviewedRefund(f, data);
    f.setNow(NOW + 1);
    const response = await authorityRequest(
      adminRequest(
        '/v1/admin/licenses/status',
        { licenseId: f.licenseId, status },
        f.env.ADMIN_TOKEN,
      ),
      f.env,
      f.authority,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await f.adjust(data), { received: true, duplicate: true });
    assert.equal(f.status(), status);
    assert.equal(f.records.get(`payment-adjustment:paddle:${data.id}`).refundItem, undefined);
  }
});

test('support decisions in the approval second win, while older ones do not block a new refund', async () => {
  for (const offset of [-1, 0]) {
    const f = await purchase();
    f.setNow(NOW + offset);
    const response = await authorityRequest(
      adminRequest(
        '/v1/admin/licenses/status',
        { licenseId: f.licenseId, status: 'active' },
        f.env.ADMIN_TOKEN,
      ),
      f.env,
      f.authority,
    );
    assert.equal(response.status, 200);
    f.setNow(NOW);
    const data = itemRefund();
    await legacyReviewedRefund(f, data);
    const result = await f.adjust(data);
    assert.equal(
      offset === 0 ? result.duplicate : result.adjustment,
      offset === 0 ? true : 'revoked',
    );
    assert.equal(f.status(), offset === 0 ? 'active' : 'revoked');
  }
});

test('legacy replay cannot replace newer adjustment state or ambiguous financial facts', async () => {
  for (const newer of [false, true]) {
    const f = await purchase();
    const data = itemRefund();
    await legacyReviewedRefund(f, data);
    if (newer) {
      const key = `payment-adjustment:paddle:${data.id}`;
      const record = f.records.get(key);
      record.occurredAt += 1;
      f.records.put(key, record);
    } else data.items[0].totals.total = '5149';
    assert.deepEqual(await f.adjust(data), { received: true, duplicate: true });
    assert.equal(f.status(), 'active');
  }
});

test('the observed Paddle full refund enriches its legacy review with microsecond provider times', async () => {
  const transactionId = 'txn_01m4jyy4khkhav8162h4v9jv3v';
  const eventId = 'evt_01m4r6194dgarsfdtg508y3haq';
  const occurredAt = '2026-10-12T13:50:02.381946Z';
  const f = await purchase(true, transactionId);
  const data = {
    ...itemRefund(),
    id: 'adj_01m4r5ky2mka3515kbh18t38an',
    transaction_id: transactionId,
    created_at: '2026-10-12T13:40:02.381946Z',
    totals: {
      subtotal: '4950',
      tax: '439',
      total: '5389',
      currency_code: 'USD',
      fee: '319',
      retained_fee: '319',
      earnings: '4631',
    },
    items: [
      {
        id: 'adjitm_01m4r5ky2mka3515kbh1vvmv1v',
        item_id: 'txnitm_01m4jyz8gapb9cnvqcgvd405ft',
        type: 'full',
        amount: '5389',
        proration: null,
        totals: { subtotal: '4950', tax: '439', total: '5389' },
      },
    ],
  };
  await legacyReviewedRefund(f, data, eventId, 2, occurredAt);
  assert.equal((await f.adjust(data, eventId, 2, occurredAt)).adjustment, 'revoked');
  const stored = f.records.get(`payment-adjustment:paddle:${data.id}`);
  assert.equal(stored.occurredAt, Date.parse(occurredAt));
  assert.equal(stored.refundItem.itemTax, 439);
  assert.equal(f.status(), 'revoked');
});
