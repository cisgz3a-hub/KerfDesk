import test from 'node:test';
import assert from 'node:assert/strict';
import { rekeyLicense } from './admin.mjs';
import { adminCredential } from './crypto.mjs';
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
  request,
  signedPaddle,
  webhookRequest,
} from './test-support.mjs';

async function adminFixture() {
  const f = await fixture();
  const call = async (path, body, token = f.env.ADMIN_TOKEN) => {
    const response = await authorityRequest(adminRequest(path, body, token), f.env, f.authority);
    return { status: response.status, body: await response.json() };
  };
  const audits = () =>
    f.database
      .prepare("SELECT key, value FROM records WHERE key LIKE 'audit:%' ORDER BY key")
      .all()
      .map((row) => ({ key: row.key, ...JSON.parse(row.value) }));
  return { ...f, call, audits };
}

/** A paid licence bought through checkout and a verified webhook. */
async function purchased(f, requestId = deviceId(70)) {
  f.env.PAYMENTS_ENABLED = 'true';
  const { checkout, intent } = await checkoutOrder(f, requestId);
  const signed = signedPaddle(f.env, paddleTransaction(f.env, intent), 'evt_purchase');
  assert.equal((await authorityRequest(webhookRequest(signed), f.env, f.authority)).status, 200);
  return { checkout, ...(await claimOrder(f.authority, checkout)) };
}

test('every administration change leaves an audit record, written in the same transaction', async () => {
  const f = await adminFixture();
  const grant = await f.call('/v1/admin/developer-grants', { grantId: 'dev', displayName: 'Dev' });
  await f.call('/v1/admin/developer-grants', { grantId: 'dev', displayName: 'Dev' });
  const { licenseId } = grant.body;
  await f.call('/v1/admin/licenses/status', { licenseId, status: 'revoked' });
  await f.call('/v1/admin/orders', {
    orderId: 'manual',
    provider: 'paddle',
    providerOrderId: 'txn_manual',
    operation: 'purchase',
  });
  await f.call('/v1/admin/licenses/lookup', { licenseId });
  await f.call('/v1/admin/licenses/rekey', { licenseId });
  const refused = await f.call('/v1/admin/developer-grants', {
    grantId: 'dev',
    displayName: 'Intruder',
  });
  assert.equal(refused.status, 409);
  assert.equal((await f.call('/v1/admin/licenses/lookup', { licenseId }, deviceId(1))).status, 401);
  const records = f.audits();
  assert.deepEqual(
    records.map(({ route, target, outcome }) => [route, target, outcome]),
    [
      ['/v1/admin/developer-grants', 'dev', 'created'],
      ['/v1/admin/developer-grants', 'dev', 'existing'],
      ['/v1/admin/licenses/status', licenseId, 'revoked'],
      ['/v1/admin/orders', 'manual', 'created'],
      ['/v1/admin/licenses/lookup', licenseId, 'key-disclosed'],
      ['/v1/admin/licenses/rekey', licenseId, 'rekeyed'],
      ['/v1/admin/developer-grants', 'dev', 'idempotency_conflict'],
    ],
  );
  assert.ok(records.every(({ at, credential }) => at === NOW && credential === 'ADMIN_TOKEN'));
  assert.equal(records[0].key, 'audit:1800000000:0000000001');
  assert.equal(records[2].previousStatus, 'active');
  const stored = JSON.stringify(records);
  for (const secret of [grant.body.licenseKey, f.env.ADMIN_TOKEN, 'Intruder'])
    assert.equal(stored.includes(secret), false);
  // The change and its record commit together: a failed audit write undoes the change.
  const put = f.records.put.bind(f.records);
  f.records.put = (key, value) => {
    if (key.startsWith('audit:')) throw new Error('simulated storage failure');
    put(key, value);
  };
  const failed = await f.call('/v1/admin/licenses/status', { licenseId, status: 'active' });
  assert.equal(failed.status, 503);
  assert.equal(f.records.get(`license:${licenseId}`).status, 'revoked');
  // A lookup that cannot be recorded discloses nothing.
  assert.equal((await f.call('/v1/admin/licenses/lookup', { licenseId })).status, 503);
});

test('a second administrator token allows rotation without downtime', async () => {
  const f = await adminFixture();
  const current = f.env.ADMIN_TOKEN;
  const next = deviceId(48);
  f.env.ADMIN_TOKEN_NEXT = next;
  const body = { grantId: 'rotation', displayName: 'Rotation' };
  assert.equal((await f.call('/v1/admin/developer-grants', body, next)).status, 200);
  assert.equal((await f.call('/v1/admin/developer-grants', body, current)).status, 200);
  assert.deepEqual(
    f.audits().map(({ credential }) => credential),
    ['ADMIN_TOKEN_NEXT', 'ADMIN_TOKEN'],
  );
  // Rotation done: the new token becomes ADMIN_TOKEN and the old one stops working.
  f.env.ADMIN_TOKEN = next;
  delete f.env.ADMIN_TOKEN_NEXT;
  assert.equal((await f.call('/v1/admin/developer-grants', body, current)).status, 401);
  assert.equal((await f.call('/v1/admin/developer-grants', body, next)).status, 200);
  // A malformed or missing token is never accepted.
  f.env.ADMIN_TOKEN_NEXT = 'short';
  assert.equal((await f.call('/v1/admin/developer-grants', body, 'short')).status, 401);
  assert.equal(await adminCredential('Bearer x', {}), null);
  assert.equal(await adminCredential(undefined, { ADMIN_TOKEN: next }), null);
});

test('rekey replaces a leaked key; keys issued before rekeying keep working until then', async () => {
  const f = await adminFixture();
  const { checkout, licenseId, licenseKey } = await purchased(f);
  const activate = (key, number) =>
    f.authority.activate({ licenseKey: key, deviceId: deviceId(number), deviceName: 'PC' });
  const first = await activate(licenseKey, 71);
  await activate(licenseKey, 72);
  assert.equal(
    (await f.call('/v1/admin/licenses/lookup', { licenseId })).body.licenseKey,
    licenseKey,
  );
  const rekeyed = await f.call('/v1/admin/licenses/rekey', { licenseId });
  assert.equal(rekeyed.status, 200);
  assert.equal(rekeyed.body.keyVersion, 1);
  assert.equal(rekeyed.body.releasedSeats, 0);
  const newKey = rekeyed.body.licenseKey;
  assert.notEqual(newKey, licenseKey);
  assert.match(newKey, new RegExp(`^KD1\\.${licenseId}\\.[A-Za-z0-9_-]{43}$`, 'u'));
  await assert.rejects(activate(licenseKey, 73), { code: 'invalid_credentials' });
  await assert.rejects(f.authority.listActivations({ licenseKey }), {
    code: 'invalid_credentials',
  });
  assert.equal(claims(await activate(newKey, 73)).licenseId, licenseId);
  // Seats already taken keep working through their activation credentials.
  assert.equal(claims(await f.authority.refresh(credentials(first))).licenseId, licenseId);
  const found = (await f.call('/v1/admin/licenses/lookup', { orderId: checkout.orderId })).body;
  assert.equal(found.licenseKey, newKey);
  assert.equal(found.keyVersion, 1);
  assert.equal((await claimOrder(f.authority, checkout)).licenseKey, newKey);
  // Freeing every seat does not count toward the six-moves cap.
  const again = await f.call('/v1/admin/licenses/rekey', { licenseId, releaseSeats: true });
  assert.deepEqual(
    { ...again.body, licenseKey: undefined },
    { licenseId, licenseKey: undefined, keyVersion: 2, releasedSeats: 3 },
  );
  await assert.rejects(activate(newKey, 74), { code: 'invalid_credentials' });
  await assert.rejects(f.authority.refresh(credentials(first)), { code: 'activation_inactive' });
  const license = f.records.get(`license:${licenseId}`);
  assert.deepEqual(license.active, []);
  assert.equal(license.releases, undefined);
  assert.equal(claims(await activate(again.body.licenseKey, 71)).licenseId, licenseId);
});

test('rekeying keeps developer grants idempotent and refuses trials, unknown licences and races', async () => {
  const f = await adminFixture();
  const body = { grantId: 'johann', displayName: 'Johann' };
  const grant = (await f.call('/v1/admin/developer-grants', body)).body;
  const rekeyed = await rekeyLicense(f.authority, { licenseId: grant.licenseId });
  assert.equal(
    (await f.call('/v1/admin/developer-grants', body)).body.licenseKey,
    rekeyed.licenseKey,
  );
  const trial = await f.authority.startTrial({ deviceId: deviceId(75), deviceName: 'PC' });
  for (const licenseId of [claims(trial).licenseId, 'missing'])
    assert.deepEqual(await f.call('/v1/admin/licenses/rekey', { licenseId }), {
      status: 404,
      body: { error: { code: 'license_not_found' } },
    });
  assert.equal(
    (await f.call('/v1/admin/licenses/rekey', { licenseId: grant.licenseId, releaseSeats: 'yes' }))
      .status,
    400,
  );
  const race = await Promise.allSettled([
    rekeyLicense(f.authority, { licenseId: grant.licenseId }),
    rekeyLicense(f.authority, { licenseId: grant.licenseId }),
  ]);
  assert.equal(race.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(race.find((item) => item.status === 'rejected').reason.code, 'idempotency_conflict');
  // The rekey route answers only an administrator.
  const anonymous = await authorityRequest(
    request('/v1/admin/licenses/rekey', { licenseId: grant.licenseId }),
    f.env,
    f.authority,
  );
  assert.equal(anonymous.status, 401);
});
