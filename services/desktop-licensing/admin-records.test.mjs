import test from 'node:test';
import assert from 'node:assert/strict';
import { authorityRequest } from './http.mjs';
import { claimOrder } from './payments.mjs';
import {
  adminRequest,
  checkoutOrder,
  claims,
  credentials,
  deviceId,
  fixture,
  NOW,
  paddleTransaction,
  signedPaddle,
  webhookRequest,
} from './test-support.mjs';

const OTHER_TXN = `txn_${'d'.repeat(26)}`;

async function recordsFixture() {
  const f = await fixture();
  f.env.PAYMENTS_ENABLED = 'true';
  const call = (path, body) =>
    authorityRequest(adminRequest(path, body, f.env.ADMIN_TOKEN), f.env, f.authority);
  const deliver = (data, eventId) =>
    authorityRequest(webhookRequest(signedPaddle(f.env, data, eventId)), f.env, f.authority);
  const all = () =>
    f.database
      .prepare('SELECT key, value FROM records ORDER BY key')
      .all()
      .map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
  // A bought licence with a seat and a refused second payment, a developer licence
  // with a seat, and a trial: every kind of record the service keeps.
  const bought = await checkoutOrder(f, deviceId(80));
  await deliver(paddleTransaction(f.env, bought.intent), 'evt_bought');
  const paid = await claimOrder(f.authority, bought.checkout);
  await deliver(paddleTransaction(f.env, bought.intent, { id: OTHER_TXN }), 'evt_copy');
  const paidSeat = await f.authority.activate({
    licenseKey: paid.licenseKey,
    deviceId: deviceId(81),
    deviceName: 'PC',
  });
  const grant = await (
    await call('/v1/admin/developer-grants', { grantId: 'other', displayName: 'Other' })
  ).json();
  const devSeat = await f.authority.activate({
    licenseKey: grant.licenseKey,
    deviceId: deviceId(82),
    deviceName: 'PC',
  });
  const trial = await f.authority.startTrial({ deviceId: deviceId(83), deviceName: 'PC' });
  return { ...f, call, all, bought, paid, paidSeat, grant, devSeat, trial };
}

test('the export pages through every record as JSON Lines and holds no secret', async () => {
  const f = await recordsFixture();
  const before = f.all().map(({ key }) => key);
  const exported = [];
  let after;
  for (let page = 0; page < 50; page += 1) {
    const response = await f.call('/v1/admin/export', { limit: 4, ...(after ? { after } : {}) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const [header, ...lines] = (await response.text()).trimEnd().split('\n').map(JSON.parse);
    assert.equal(header.format, 'kerfdesk-licensing-export');
    assert.equal(header.version, 1);
    assert.equal(header.exportedAt, NOW);
    assert.equal(header.count, lines.length);
    exported.push(...lines);
    if (header.next === null) break;
    after = header.next;
  }
  const keys = exported.map(({ key }) => key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of before) assert.ok(keys.includes(key), key);
  const license = exported.find(({ key }) => key === `license:${f.paid.licenseId}`);
  assert.equal(license.value.tier, 'paid');
  const text = JSON.stringify(exported);
  const jwk = JSON.parse(f.env.SIGNING_PRIVATE_JWK);
  for (const secret of [
    f.paid.licenseKey,
    f.grant.licenseKey,
    f.paidSeat.activationToken,
    f.devSeat.activationToken,
    f.trial.activationToken,
    f.bought.checkout.claimToken,
    f.bought.intent.orderProof,
    f.env.ADMIN_TOKEN,
    f.env.HASH_SECRET,
    f.env.DERIVATION_SECRET,
    jwk.d,
    deviceId(80),
    deviceId(81),
  ])
    assert.equal(text.includes(secret), false, secret);
  const audit = exported.filter(({ value }) => value.route === '/v1/admin/export');
  assert.ok(audit.length >= 1);
  for (const body of [{ limit: 0 }, { limit: 5001 }, { limit: '5' }, { everything: true }])
    assert.equal((await f.call('/v1/admin/export', body)).status, 400);
});

test('deleting a customer removes their licence, seats, orders and payments, and nothing else', async () => {
  const f = await recordsFixture();
  const { licenseId, licenseKey } = f.paid;
  const { orderId } = f.bought.checkout;
  const refused = await f.call('/v1/admin/customers/delete', { orderId });
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: { code: 'license_not_revoked' } });
  assert.equal(f.records.get(`license:${licenseId}`).status, 'active');
  await f.authority.setLicenseStatus({ licenseId, status: 'revoked' });
  const deleted = await f.call('/v1/admin/customers/delete', { orderId });
  assert.equal(deleted.status, 200);
  const result = await deleted.json();
  assert.equal(result.licenseId, licenseId);
  // Licence, seat, order, checkout request, transaction binding, payment, event, and
  // the refused second payment with its binding-free record.
  assert.equal(result.deletedRecords, 8);
  const left = f.all().filter(({ key }) => !key.startsWith('audit'));
  const remaining = JSON.stringify(left);
  for (const trace of [licenseId, orderId, OTHER_TXN])
    assert.equal(remaining.includes(trace), false, trace);
  await assert.rejects(
    f.authority.activate({ licenseKey, deviceId: deviceId(84), deviceName: 'PC' }),
    { code: 'invalid_credentials' },
  );
  await assert.rejects(claimOrder(f.authority, f.bought.checkout), {
    code: 'invalid_credentials',
  });
  assert.equal((await f.call('/v1/admin/customers/delete', { orderId })).status, 404);
  assert.equal((await f.call('/v1/admin/customers/delete', { licenseId })).status, 404);
  // The audit keeps every attempt, refused or not, by IDs and outcomes only.
  const audit = f
    .all()
    .filter(({ value }) => value.route === '/v1/admin/customers/delete')
    .map(({ value }) => ({ ...value, at: undefined }));
  const entry = (target, outcome, extra = {}) => ({
    route: '/v1/admin/customers/delete',
    target,
    outcome,
    ...extra,
    credential: 'ADMIN_TOKEN',
    at: undefined,
  });
  assert.deepEqual(audit, [
    entry(orderId, 'license_not_revoked'),
    entry(licenseId, 'deleted', { deletedRecords: 8 }),
    entry(orderId, 'order_not_found'),
    entry(licenseId, 'license_not_found'),
  ]);
  // Everyone else is untouched.
  assert.equal(claims(await f.authority.refresh(credentials(f.devSeat))).tier, 'developer');
  assert.equal(claims(await f.authority.refresh(credentials(f.trial))).tier, 'trial');
});

test('a trial is deleted without revoking, and a developer grant only after revoking', async () => {
  const f = await recordsFixture();
  const trialId = claims(f.trial).licenseId;
  const trial = await f.call('/v1/admin/customers/delete', { licenseId: trialId });
  assert.equal((await trial.json()).deletedRecords, 2);
  await assert.rejects(f.authority.refresh(credentials(f.trial)), {
    code: 'invalid_credentials',
  });
  // With its record gone, that installation could start a new trial.
  f.setNow(NOW + 86_400);
  const again = await f.authority.startTrial({ deviceId: deviceId(83), deviceName: 'PC' });
  assert.equal(claims(again).accessExpiresAt, NOW + 86_400 + 30 * 86_400);
  const { licenseId } = f.grant;
  assert.equal((await f.call('/v1/admin/customers/delete', { licenseId })).status, 409);
  await f.authority.setLicenseStatus({ licenseId, status: 'revoked' });
  const grant = await f.call('/v1/admin/customers/delete', { licenseId });
  assert.equal((await grant.json()).deletedRecords, 3);
  assert.equal(f.records.get('grant:other'), undefined);
  for (const body of [{}, { licenseId, orderId: 'x' }, { licenseId: 'bad id' }])
    assert.equal((await f.call('/v1/admin/customers/delete', body)).status, 400);
});

test('an order that never became a licence is deleted by its number alone', async () => {
  const f = await recordsFixture();
  const txn = `txn_${'e'.repeat(26)}`;
  const refused = await checkoutOrder(f, deviceId(85), undefined, txn);
  const discounted = paddleTransaction(f.env, refused.intent, { id: txn, discount_id: 'dsc_x' });
  await authorityRequest(
    webhookRequest(signedPaddle(f.env, discounted, 'evt_refused')),
    f.env,
    f.authority,
  );
  const { orderId } = refused.checkout;
  assert.equal(f.records.get(`order:${orderId}`).status, 'rejected');
  const deleted = await (await f.call('/v1/admin/customers/delete', { orderId })).json();
  // The order, its checkout request, its transaction binding and the refusal record.
  assert.equal(deleted.deletedRecords, 4);
  const remaining = JSON.stringify(f.all().filter(({ key }) => !key.startsWith('audit')));
  for (const trace of [orderId, txn]) assert.equal(remaining.includes(trace), false, trace);
  // The paid customer from the fixture keeps everything.
  assert.equal(f.records.get(`license:${f.paid.licenseId}`).status, 'active');
  assert.equal(f.records.get(`order:${f.bought.checkout.orderId}`).status, 'fulfilled');
});
