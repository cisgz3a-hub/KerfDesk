/* global crypto */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { LicensingAuthority, nextUpdateYear } from './authority.mjs';
import { base64url } from './crypto.mjs';
import { SqliteRecords } from './storage.mjs';
import { claims, credentials, deviceId, fixture, NOW } from './test-support.mjs';

test('trial is signed, server anchored, restart stable, and ends exactly after 30 days', async () => {
  const f = await fixture();
  const body = { deviceId: deviceId(1), deviceName: 'Workstation' };
  const first = await f.authority.startTrial(body);
  assert.equal(claims(first).accessExpiresAt, NOW + 30 * 86_400);
  assert.equal(claims(first).updatesUntil, claims(first).accessExpiresAt);
  const restarted = new LicensingAuthority(
    new SqliteRecords(f.storage),
    f.authority.crypto,
    () => NOW + 86_400,
  );
  const second = await restarted.startTrial(body);
  assert.equal(claims(second).accessExpiresAt, claims(first).accessExpiresAt);
  assert.equal(claims(second).activationId, claims(first).activationId);
  assert.equal(second.activationToken, first.activationToken);
  await f.authority.deactivate(credentials(first));
  f.setNow(NOW + 30 * 86_400);
  await assert.rejects(f.authority.startTrial(body), { code: 'trial_expired' });
});

test('named developer grants require distinct keys and idempotent names, carry perpetual updates', async () => {
  const f = await fixture();
  const johann = await f.authority.developerGrant({ grantId: 'johann', displayName: 'Johann' });
  const father = await f.authority.developerGrant({ grantId: 'father', displayName: 'Father' });
  assert.notEqual(johann.licenseKey, father.licenseKey);
  assert.deepEqual(
    await f.authority.developerGrant({ grantId: 'johann', displayName: 'Johann' }),
    johann,
  );
  await assert.rejects(f.authority.developerGrant({ grantId: 'johann', displayName: 'Intruder' }), {
    code: 'idempotency_conflict',
  });
  const activation = await f.authority.activate({
    licenseKey: johann.licenseKey,
    deviceId: deviceId(2),
    deviceName: 'Johann desktop',
  });
  const payload = claims(activation);
  assert.equal(payload.tier, 'developer');
  assert.equal(payload.perpetualUpdates, true);
  assert.equal(payload.updatesUntil, null);
  assert.equal(payload.accessExpiresAt, null);
  assert.equal(payload.maxDevices, 3);
});

test('Ed25519 signature rejects tier/expiry/device tampering and a different signing key', async () => {
  const f = await fixture();
  const result = await f.authority.startTrial({ deviceId: deviceId(3), deviceName: 'PC' });
  const verify = (payload, key = f.pair.publicKey) =>
    crypto.subtle.verify(
      'Ed25519',
      key,
      Buffer.from(result.entitlement.signature, 'base64url'),
      Buffer.from(payload, 'base64url'),
    );
  assert.equal(await verify(result.entitlement.payload), true);
  for (const changed of [
    { tier: 'developer', perpetualUpdates: true, updatesUntil: null, accessExpiresAt: null },
    { deviceId: deviceId(4) },
    { accessExpiresAt: NOW + 999_999_999 },
  ]) {
    const tampered = base64url(Buffer.from(JSON.stringify({ ...claims(result), ...changed })));
    assert.equal(await verify(tampered), false);
  }
  const other = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  assert.equal(await verify(result.entitlement.payload, other.publicKey), false);
});

test('concurrent distinct activations allocate exactly three seats; repeated device consumes one', async () => {
  const f = await fixture();
  const grant = await f.authority.developerGrant({
    grantId: 'seat-test',
    displayName: 'Developer',
  });
  const outcomes = await Promise.allSettled(
    Array.from({ length: 12 }, (_, index) =>
      f.authority.activate({
        licenseKey: grant.licenseKey,
        deviceId: deviceId(index),
        deviceName: `PC${index}`,
      }),
    ),
  );
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 3);
  assert.equal(
    outcomes.filter(
      (result) => result.status === 'rejected' && result.reason.code === 'device_limit_reached',
    ).length,
    9,
  );
  const existing = outcomes.find((result) => result.status === 'fulfilled').value;
  const repeated = await f.authority.activate({
    licenseKey: grant.licenseKey,
    deviceId: claims(existing).deviceId,
    deviceName: 'Renamed',
  });
  assert.equal(claims(repeated).activationId, claims(existing).activationId);
  assert.equal(
    (await f.authority.listActivations({ licenseKey: grant.licenseKey })).activations.length,
    3,
  );
});

test('transfer rejects stolen or stale bearer; idempotent old deactivate cannot remove reactivation', async () => {
  const f = await fixture();
  const grant = await f.authority.developerGrant({ grantId: 'transfer', displayName: 'Developer' });
  const body = { licenseKey: grant.licenseKey, deviceId: deviceId(11), deviceName: 'PC' };
  const original = await f.authority.activate(body);
  await assert.rejects(
    f.authority.deactivate({ ...credentials(original), activationToken: deviceId(90) }),
    { code: 'invalid_credentials' },
  );
  await assert.rejects(f.authority.refresh({ ...credentials(original), deviceId: deviceId(12) }), {
    code: 'invalid_credentials',
  });
  await f.authority.deactivate(credentials(original));
  await assert.rejects(f.authority.refresh(credentials(original)), { code: 'activation_inactive' });
  const replacement = await f.authority.activate(body);
  assert.notEqual(claims(replacement).activationId, claims(original).activationId);
  await f.authority.deactivate(credentials(original));
  assert.equal(
    claims(await f.authority.refresh(credentials(replacement))).activationId,
    claims(replacement).activationId,
  );
});

test('wrong licence cannot remotely free someone else’s seat; raw secrets and fingerprints are absent from SQLite', async () => {
  const f = await fixture();
  const a = await f.authority.developerGrant({ grantId: 'a', displayName: 'A' });
  const b = await f.authority.developerGrant({ grantId: 'b', displayName: 'B' });
  const activation = await f.authority.activate({
    licenseKey: a.licenseKey,
    deviceId: deviceId(13),
    deviceName: 'PC',
  });
  await assert.rejects(
    f.authority.releaseWithKey({
      licenseKey: b.licenseKey,
      activationId: claims(activation).activationId,
    }),
    { code: 'activation_not_found' },
  );
  const raw = JSON.stringify(f.database.prepare('SELECT * FROM records').all());
  for (const value of [
    a.licenseKey,
    activation.activationToken,
    deviceId(13),
    f.env.ADMIN_TOKEN,
    f.env.SIGNING_PRIVATE_JWK,
  ])
    assert.equal(raw.includes(value), false);
});

test('SQLite transaction rolls back a failed partial write and leap-year renewal is clamped', async () => {
  const f = await fixture();
  assert.throws(() =>
    f.records.transaction((tx) => {
      tx.put('partial', { value: true });
      throw new Error('injected failure');
    }),
  );
  assert.equal(f.records.get('partial'), undefined);
  assert.equal(
    new Date(nextUpdateYear(Date.parse('2028-02-29T12:00:00Z') / 1000) * 1000).toISOString(),
    '2029-02-28T12:00:00.000Z',
  );
});
