import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOrder, fulfilVerifiedPayment, claimOrder } from './payments.mjs';
import { nextUpdateYear } from './authority.mjs';
import { claims, credentials, deviceId, fixture, NOW } from './test-support.mjs';

function event(orderId, overrides = {}) {
  return {
    eventId: `event-${orderId}`,
    orderId,
    provider: 'paddle',
    providerOrderId: `transaction-${orderId}`,
    paymentId: `payment-${orderId}`,
    amount: 4950,
    currency: 'USD',
    status: 'paid',
    ...overrides,
  };
}

async function paid(f) {
  const order = await prepareOrder(f.authority, {
    orderId: 'purchase',
    provider: 'paddle',
    providerOrderId: 'transaction-purchase',
    operation: 'purchase',
  });
  await fulfilVerifiedPayment(f.authority, event('purchase'));
  return claimOrder(f.authority, order);
}

test('purchase remains pending until exact authenticated completion; retries grant one licence', async () => {
  const f = await fixture();
  const order = await prepareOrder(f.authority, {
    orderId: 'purchase',
    provider: 'paddle',
    providerOrderId: 'transaction-purchase',
    operation: 'purchase',
  });
  await assert.rejects(claimOrder(f.authority, order), { code: 'payment_pending' });
  await assert.rejects(claimOrder(f.authority, { ...order, claimToken: deviceId(1) }), {
    code: 'invalid_credentials',
  });
  for (const mismatch of [
    { amount: 1 },
    { currency: 'ZAR' },
    { providerOrderId: 'another' },
    { provider: 'another' },
    { status: 'pending' },
  ])
    await assert.rejects(fulfilVerifiedPayment(f.authority, event('purchase', mismatch)));
  const fulfilled = await Promise.all(
    Array.from({ length: 8 }, () => fulfilVerifiedPayment(f.authority, event('purchase'))),
  );
  assert.equal(fulfilled.filter((item) => !item.duplicate).length, 1);
  const license = await claimOrder(f.authority, order);
  const activation = await f.authority.activate({
    licenseKey: license.licenseKey,
    deviceId: deviceId(2),
    deviceName: 'Paid PC',
  });
  assert.equal(claims(activation).tier, 'paid');
  assert.equal(claims(activation).accessExpiresAt, null);
  assert.equal(claims(activation).updatesUntil, nextUpdateYear(NOW));
  f.setNow(nextUpdateYear(NOW) + 86_400);
  const afterYear = claims(await f.authority.refresh(credentials(activation)));
  assert.equal(afterYear.accessExpiresAt, null);
  assert.ok(afterYear.updatesUntil < afterYear.issuedAt);
});

test('renewals extend once from later of existing expiry or server time; concurrent distinct payments accumulate', async () => {
  const f = await fixture();
  const license = await paid(f);
  for (const orderId of ['r1', 'r2'])
    await prepareOrder(f.authority, {
      orderId,
      provider: 'paddle',
      providerOrderId: `transaction-${orderId}`,
      operation: 'renewal',
      licenseId: license.licenseId,
    });
  await Promise.all(
    ['r1', 'r2'].flatMap((id) =>
      [1, 2, 3].map(() => fulfilVerifiedPayment(f.authority, event(id, { amount: 2000 }))),
    ),
  );
  assert.equal(
    f.records.get(`license:${license.licenseId}`).updatesUntil,
    nextUpdateYear(nextUpdateYear(nextUpdateYear(NOW))),
  );
  const future = nextUpdateYear(nextUpdateYear(nextUpdateYear(nextUpdateYear(NOW))));
  f.setNow(future);
  await prepareOrder(f.authority, {
    orderId: 'r3',
    provider: 'paddle',
    providerOrderId: 'transaction-r3',
    operation: 'renewal',
    licenseId: license.licenseId,
  });
  await fulfilVerifiedPayment(f.authority, event('r3', { amount: 2000 }));
  assert.equal(f.records.get(`license:${license.licenseId}`).updatesUntil, nextUpdateYear(future));
});

test('payment, event, and order IDs cannot be rebound or reused across orders', async () => {
  const f = await fixture();
  await paid(f);
  await assert.rejects(
    prepareOrder(f.authority, {
      orderId: 'purchase',
      provider: 'paddle',
      providerOrderId: 'another',
      operation: 'purchase',
    }),
    { code: 'idempotency_conflict' },
  );
  await assert.rejects(
    prepareOrder(f.authority, {
      orderId: 'other',
      provider: 'paddle',
      providerOrderId: 'transaction-purchase',
      operation: 'purchase',
    }),
    { code: 'provider_order_reused' },
  );
  await assert.rejects(
    fulfilVerifiedPayment(f.authority, event('purchase', { paymentId: 'different' })),
    { code: 'idempotency_conflict' },
  );
  await prepareOrder(f.authority, {
    orderId: 'other',
    provider: 'paddle',
    providerOrderId: 'transaction-other',
    operation: 'purchase',
  });
  await assert.rejects(
    fulfilVerifiedPayment(f.authority, event('other', { paymentId: 'payment-purchase' })),
    { code: 'payment_reused' },
  );
  await assert.rejects(
    fulfilVerifiedPayment(f.authority, event('other', { eventId: 'event-purchase' })),
    { code: 'idempotency_conflict' },
  );
  assert.equal(f.records.get('order:other').status, 'pending');
});

test('failure while recording payment rolls back the licence grant and retry succeeds', async () => {
  const f = await fixture();
  await prepareOrder(f.authority, {
    orderId: 'failure',
    provider: 'paddle',
    providerOrderId: 'transaction-failure',
    operation: 'purchase',
  });
  const put = f.records.put.bind(f.records);
  f.records.put = (key, value) => {
    if (key.startsWith('payment-event:')) throw new Error('simulated storage failure');
    put(key, value);
  };
  await assert.rejects(fulfilVerifiedPayment(f.authority, event('failure')));
  const order = f.records.get('order:failure');
  assert.equal(order.status, 'pending');
  assert.equal(f.records.get(`license:${order.licenseId}`), undefined);
  f.records.put = put;
  assert.equal((await fulfilVerifiedPayment(f.authority, event('failure'))).duplicate, false);
});
