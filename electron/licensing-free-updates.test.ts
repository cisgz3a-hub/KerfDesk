// @vitest-environment node
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import type { LicensingConfig } from './licensing-config';
import type { LicenceRecord } from './licensing-store';
import type { LicenceClaims } from './licensing-verification';

const now = Date.parse('2026-10-06T00:00:00Z');
const pair = generateKeyPairSync('ed25519');
const keys = { test: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
const device = createHash('sha256').update('synthetic-test-pc').digest('base64url');
function signed(payload: unknown, entitlement = false) {
  const bytes = Buffer.from(JSON.stringify(payload));
  const encoding = entitlement ? 'base64url' : 'base64';
  return {
    ...(entitlement ? {} : { schemaVersion: 1, algorithm: 'Ed25519' }),
    keyId: 'test',
    payload: bytes.toString(encoding),
    signature: sign(null, bytes, pair.privateKey).toString(encoding),
  };
}
const config: LicensingConfig = {
  channel: 'commercial',
  manualUpdates: true,
  apiOrigin: 'https://licensing.example',
  entitlementKeys: keys,
  releaseKeys: keys,
  release: signed({
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'release-identity',
    channel: 'stable',
    version: '1.0.10',
    sourceSha: 'a'.repeat(40),
    sourceRef: 'refs/heads/main',
    publishedAt: '2026-10-04T00:00:00.000Z',
  }),
};
const update = {
  schemaVersion: 1,
  product: 'kerfdesk-desktop',
  channel: 'stable',
  version: '1.0.11',
  sourceSha: 'b'.repeat(40),
  sourceRef: 'refs/heads/main',
  publishedAt: '2026-10-05T00:00:00.000Z',
};
const signedUpdate = signed({ ...update, kind: 'update-manifest' });
const manual = JSON.stringify(
  signed({
    ...update,
    kind: 'manual-download',
    codeSigning: 'unsigned',
    updates: 'manual',
    artifacts: [
      {
        name: 'KerfDesk-1.0.11-windows-x64-setup.exe',
        bytes: 1,
        sha256: createHash('sha256').update('x').digest('hex'),
      },
    ],
  }),
);
function record(patch: Partial<LicenceClaims> = {}): LicenceRecord {
  return {
    schemaVersion: 1,
    lastSeenAt: now / 1000,
    credential: {
      entitlement: signed(
        {
          schemaVersion: 1,
          product: 'kerfdesk-desktop',
          licenseId: 'license-test',
          activationId: 'seat-test',
          deviceId: device,
          tier: 'paid',
          issuedAt: now / 1000 - 31 * 86400,
          accessExpiresAt: null,
          updatesUntil: now / 1000 + 365 * 86400,
          perpetualUpdates: false,
          maxDevices: 3,
          ...patch,
        },
        true,
      ),
      activationToken: Buffer.alloc(32, 2).toString('base64url'),
    },
  };
}
function harness(initial: LicenceRecord | null = null) {
  let saved = initial;
  const fetch = vi.fn(async (): Promise<Response> => {
    throw new Error('Synthetic offline failure');
  });
  const store = {
    read: async () => saved,
    write: async (value: LicenceRecord) => {
      saved = value;
    },
    reset: async () => {
      saved = null;
    },
  };
  const runtime = createLicensingRuntime({
    config,
    currentVersion: '1.0.10',
    deviceId: async () => device,
    deviceName: 'Synthetic PC',
    store,
    now: () => now,
    fetch,
  });
  return { runtime, fetch, saved: () => saved };
}

describe('Free signed updates after licensing failures', () => {
  it('keeps both update lanes eligible after an offline trial attempt without acquiring rights', async () => {
    const h = harness();
    expect(await h.runtime.isManualReleaseEligible(manual, '1.0.11')).toBe(true);
    expect(await h.runtime.startTrial()).toMatchObject({
      edition: 'free',
      state: 'activation-required',
    });
    expect(h.saved()).toBeNull();
    await h.runtime.status();
    await h.runtime.refreshInBackground();
    expect(await h.runtime.isManualReleaseEligible(manual, '1.0.11')).toBe(true);
    expect(h.runtime.isReleaseEligibleCached(signedUpdate, '1.0.11')).toBe(true);
    expect(h.runtime.proUnlocked()).toBe(false);
    expect(await h.runtime.isManualReleaseEligible(manual, '1.0.12')).toBe(false);
    expect(
      await h.runtime.isManualReleaseEligible(
        manual.replace('"signature":"', '"signature":"X'),
        '1.0.11',
      ),
    ).toBe(false);
  });
  it.each(['offline', 'trial-expired'])(
    'keeps an ended trial Free and update eligible after %s refresh',
    async (failure) => {
      const h = harness(
        record({
          tier: 'trial',
          accessExpiresAt: now / 1000 - 86400,
          updatesUntil: now / 1000 - 86400,
        }),
      );
      if (failure === 'trial-expired')
        h.fetch.mockResolvedValueOnce(
          Response.json({ error: { code: 'trial_expired' } }, { status: 403 }),
        );
      expect(await h.runtime.status()).toMatchObject({ edition: 'free', state: 'trial-expired' });
      expect(await h.runtime.refresh()).toMatchObject({ edition: 'free', state: 'trial-expired' });
      expect(await h.runtime.isManualReleaseEligible(manual, '1.0.11')).toBe(true);
      expect(h.runtime.isReleaseEligibleCached(signedUpdate, '1.0.11')).toBe(true);
      expect(h.runtime.proUnlocked()).toBe(false);
    },
  );
  it.each(['paid', 'trial'] as const)(
    'continues failing closed for %s update rights after offline authentication',
    async (tier) => {
      const h = harness(
        record(
          tier === 'trial'
            ? {
                tier,
                issuedAt: now / 1000 - 86400,
                accessExpiresAt: now / 1000 + 86400,
                updatesUntil: now / 1000 + 86400,
              }
            : { tier },
        ),
      );
      expect(await h.runtime.isManualReleaseEligible(manual, '1.0.11')).toBe(true);
      await h.runtime.refresh();
      await h.runtime.status();
      expect(await h.runtime.isManualReleaseEligible(manual, '1.0.11')).toBe(false);
      expect(h.runtime.isReleaseEligibleCached(signedUpdate, '1.0.11')).toBe(false);
    },
  );
  it('does not classify invalid trial credentials or pending deactivation as eligible Free', async () => {
    for (const saved of [
      record({
        tier: 'trial',
        accessExpiresAt: now / 1000 - 86400,
        updatesUntil: now / 1000 - 86400,
        deviceId: 'b'.repeat(43),
      }),
      {
        schemaVersion: 1,
        lastSeenAt: now / 1000,
        pendingDeactivation: record().credential,
      } as LicenceRecord,
    ]) {
      const h = harness(saved);
      await h.runtime.refresh();
      expect(await h.runtime.isManualReleaseEligible(manual, '1.0.11')).toBe(false);
      expect(h.runtime.isReleaseEligibleCached(signedUpdate, '1.0.11')).toBe(false);
    }
  });
});
