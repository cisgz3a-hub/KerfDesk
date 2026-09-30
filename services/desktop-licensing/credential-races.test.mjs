import test from 'node:test';
import assert from 'node:assert/strict';
import { rekeyLicense } from './admin.mjs';
import { credentials, deviceId, fixture } from './test-support.mjs';

function barrier() {
  let unblock;
  let announce;
  const waiting = new Promise((resolve) => {
    announce = resolve;
  });
  const resumed = new Promise((resolve) => {
    unblock = resolve;
  });
  return {
    waiting,
    release: () => unblock(),
    pause: async () => {
      announce();
      await resumed;
    },
  };
}

test('rotating a leaked key before seat allocation rejects an already authenticated old-key request', async (t) => {
  const f = await fixture();
  t.after(() => f.database.close());
  const grant = await f.authority.developerGrant({
    grantId: 'race-test',
    displayName: 'Synthetic',
  });
  const gate = barrier();
  const originalHash = f.authority.crypto.hash;
  let hold = true;
  f.authority.crypto = {
    ...f.authority.crypto,
    hash: async (domain, value) => {
      if (domain === 'activation-token' && hold) {
        hold = false;
        await gate.pause();
      }
      return originalHash(domain, value);
    },
  };
  const pending = f.authority.activate({
    licenseKey: grant.licenseKey,
    deviceId: deviceId(111),
    deviceName: 'Old key',
  });
  const rejected = assert.rejects(pending, { code: 'invalid_credentials' });
  await gate.waiting;
  const rotated = await rekeyLicense(f.authority, {
    licenseId: grant.licenseId,
    releaseSeats: true,
  });
  gate.release();
  await rejected;
  assert.deepEqual(f.records.get(`license:${grant.licenseId}`).active, []);
  await f.authority.activate({
    licenseKey: rotated.licenseKey,
    deviceId: deviceId(111),
    deviceName: 'New key',
  });
  assert.equal(f.records.get(`license:${grant.licenseId}`).active.length, 1);
});

test('revocation or seat release during signing prevents a fresh successful grant response', async (t) => {
  for (const change of ['revoke', 'release']) {
    const f = await fixture();
    t.after(() => f.database.close());
    const grant = await f.authority.developerGrant({
      grantId: `sign-${change}`,
      displayName: 'Synthetic',
    });
    const activated = await f.authority.activate({
      licenseKey: grant.licenseKey,
      deviceId: deviceId(112),
      deviceName: 'Synthetic PC',
    });
    const gate = barrier();
    const originalSign = f.authority.crypto.sign;
    f.authority.crypto = {
      ...f.authority.crypto,
      sign: async (claims) => {
        await gate.pause();
        return originalSign(claims);
      },
    };
    const pending = f.authority.refresh(credentials(activated));
    const rejected = assert.rejects(pending, {
      code: change === 'revoke' ? 'license_revoked' : 'activation_inactive',
    });
    await gate.waiting;
    if (change === 'revoke')
      f.authority.setLicenseStatus({ licenseId: grant.licenseId, status: 'revoked' });
    else await f.authority.deactivate(credentials(activated));
    gate.release();
    await rejected;
  }
});
