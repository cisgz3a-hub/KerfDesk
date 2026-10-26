/* global crypto */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { authorityRequest } from './http.mjs';
import { claims, credentials, deviceId, fixture, NOW, request } from './test-support.mjs';

// ADR-592 Amendment 1: the nonce an app sends with a refresh comes back inside
// the signed grant. Only 1.0.21 and 1.0.22 send one; the Worker keeps signing it
// back so those installed apps get the answer they check for (ADR-592 Amendment 3).

async function paidSeat() {
  const f = await fixture();
  const licenseId = f.authority.crypto.id();
  const licenseKey = await f.authority.licenseKey(licenseId);
  const keyHash = await f.authority.crypto.hash('license-key', licenseKey);
  f.records.transaction((tx) =>
    tx.put(`license:${licenseId}`, {
      licenseId,
      tier: 'paid',
      status: 'active',
      issuedAt: NOW,
      accessExpiresAt: null,
      updatesUntil: NOW + 365 * 86_400,
      perpetualUpdates: false,
      keyHash,
      active: [],
    }),
  );
  const activated = await f.authority.activate({
    licenseKey,
    deviceId: deviceId(1),
    deviceName: 'Workshop PC',
  });
  return { ...f, licenseId, licenseKey, activated, seat: credentials(activated) };
}

function verifies(f, entitlement) {
  return crypto.subtle.verify(
    'Ed25519',
    f.pair.publicKey,
    Buffer.from(entitlement.signature, 'base64url'),
    Buffer.from(entitlement.payload, 'base64url'),
  );
}

test('a refresh signs back the nonce it was sent, under the grant signature', async () => {
  const f = await paidSeat();
  const first = await f.authority.refresh({ ...f.seat, refreshNonce: deviceId(60) });
  assert.equal(claims(first).refreshNonce, deviceId(60));
  assert.equal(await verifies(f, first.entitlement), true);
  // Swapping in the nonce of a later request breaks the signature.
  const swapped = { ...claims(first), refreshNonce: deviceId(61) };
  const forged = {
    ...first.entitlement,
    payload: Buffer.from(JSON.stringify(swapped)).toString('base64url'),
  };
  assert.equal(await verifies(f, forged), false);
  f.setNow(NOW + 3600);
  const second = await f.authority.refresh({ ...f.seat, refreshNonce: deviceId(61) });
  assert.equal(claims(second).refreshNonce, deviceId(61));
  assert.equal(claims(second).issuedAt, NOW + 3600);
  assert.equal(await verifies(f, second.entitlement), true);
});

test('an older app that sends no nonce gets the grant it always did', async () => {
  const f = await paidSeat();
  const plain = claims(await f.authority.refresh(f.seat));
  assert.equal(Object.hasOwn(plain, 'refreshNonce'), false);
  assert.equal(Object.hasOwn(claims(f.activated), 'refreshNonce'), false);
  // Only a refresh echoes a nonce: activation and a trial never sign one.
  const again = await f.authority.activate({
    licenseKey: f.licenseKey,
    deviceId: deviceId(1),
    deviceName: 'Workshop PC',
    refreshNonce: deviceId(62),
  });
  assert.equal(Object.hasOwn(claims(again), 'refreshNonce'), false);
  const trial = await f.authority.startTrial({
    deviceId: deviceId(2),
    deviceName: 'PC',
    refreshNonce: deviceId(63),
  });
  assert.equal(Object.hasOwn(claims(trial), 'refreshNonce'), false);
});

test('a malformed nonce is refused before a grant is signed', async () => {
  const f = await paidSeat();
  for (const refreshNonce of ['short', deviceId(60).slice(1), `${deviceId(60)}=`, 7, null]) {
    await assert.rejects(f.authority.refresh({ ...f.seat, refreshNonce }), {
      code: 'invalid_request',
    });
  }
});

test('a nonce does not let a revoked licence or a released seat refresh', async () => {
  const f = await paidSeat();
  f.authority.setLicenseStatus({ licenseId: f.licenseId, status: 'revoked' });
  await assert.rejects(f.authority.refresh({ ...f.seat, refreshNonce: deviceId(60) }), {
    code: 'license_revoked',
  });
  f.authority.setLicenseStatus({ licenseId: f.licenseId, status: 'active' });
  await f.authority.deactivate(f.seat);
  await assert.rejects(f.authority.refresh({ ...f.seat, refreshNonce: deviceId(60) }), {
    code: 'activation_inactive',
  });
});

test('the refresh route passes the nonce through to the signed grant', async () => {
  const f = await paidSeat();
  const response = await authorityRequest(
    request('/v1/activations/refresh', { ...f.seat, refreshNonce: deviceId(64) }),
    f.env,
    f.authority,
  );
  assert.equal(response.status, 200);
  const grant = await response.json();
  assert.equal(claims(grant).refreshNonce, deviceId(64));
  assert.equal(await verifies(f, grant.entitlement), true);
  const refused = await authorityRequest(
    request('/v1/activations/refresh', { ...f.seat, refreshNonce: 'short' }),
    f.env,
    f.authority,
  );
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), { error: { code: 'invalid_request' } });
});
