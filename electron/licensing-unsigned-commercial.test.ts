// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { prepareCommercialMetadata } from '../scripts/prepare-commercial-desktop.mjs';
import { licensingConfigFromMetadata } from './licensing-config.js';
import { createLicensingRuntime } from './licensing-runtime.js';
import type { LicenceRecord } from './licensing-store.js';
import {
  updateChannelTrustedFromPackageMetadata,
  previewUpdateEnabledFromPackageMetadata,
  resolveDesktopUpdateModes,
} from './update-channel-trust.js';

describe('unsigned production commercial licence runtime', () => {
  it('opens Free offline, unlocks only valid developer entitlement, and enables no update channel', async () => {
    const release = generateKeyPairSync('ed25519');
    const entitlement = generateKeyPairSync('ed25519');
    const now = Date.parse('2026-09-30T01:00:00.000Z');
    const deviceId = 'd'.repeat(43);
    const metadata = prepareCommercialMetadata(
      {
        unsignedInstaller: true,
        version: '1.2.3',
        sourceSha: 'a'.repeat(40),
        sourceRef: 'refs/tags/v1.2.3',
        publishedAt: new Date(now).toISOString(),
        keyId: 'stable-test',
        privateKeyPem: release.privateKey.export({ format: 'pem', type: 'pkcs8' }),
        releaseKeySet: {
          schemaVersion: 1,
          keys: [
            {
              keyId: 'stable-test',
              channel: 'stable',
              algorithm: 'Ed25519',
              publicKeySpki: release.publicKey
                .export({ format: 'der', type: 'spki' })
                .toString('base64'),
            },
          ],
        },
        entitlementKeySet: {
          schemaVersion: 1,
          keys: [
            {
              keyId: 'entitlement-test',
              algorithm: 'Ed25519',
              publicKeySpki: entitlement.publicKey
                .export({ format: 'der', type: 'spki' })
                .toString('base64'),
            },
          ],
        },
      },
      now,
    );
    const config = licensingConfigFromMetadata(metadata);
    expect(config).toMatchObject({
      channel: 'commercial',
      apiOrigin: 'https://license.kerfdesk.com',
    });
    expect('sandbox' in config).toBe(false);
    expect(
      resolveDesktopUpdateModes(
        updateChannelTrustedFromPackageMetadata(metadata),
        previewUpdateEnabledFromPackageMetadata(metadata),
      ),
    ).toEqual({ trustedUpdater: false, previewNotification: false });
    let saved: LicenceRecord | null = null;
    const fetch = vi.fn();
    const options = {
      config,
      currentVersion: metadata.version,
      deviceId: async () => deviceId,
      deviceName: 'Fixture',
      now: () => now,
      fetch,
      store: {
        read: async () => saved,
        write: async (record: LicenceRecord) => {
          saved = record;
        },
        reset: async () => {
          saved = null;
        },
      },
    };
    const unlicensed = createLicensingRuntime(options);
    expect(await unlicensed.status()).toMatchObject({
      channel: 'commercial',
      edition: 'free',
      state: 'activation-required',
    });
    expect(unlicensed.proUnlocked()).toBe(false);
    const payload = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        product: 'kerfdesk-desktop',
        licenseId: 'licence-fixture',
        activationId: 'activation-fixture',
        deviceId,
        tier: 'developer',
        issuedAt: now / 1000,
        accessExpiresAt: null,
        updatesUntil: null,
        perpetualUpdates: true,
        maxDevices: 3,
      }),
    );
    const envelope = {
      keyId: 'entitlement-test',
      payload: payload.toString('base64url'),
      signature: sign(null, payload, entitlement.privateKey).toString('base64url'),
    };
    saved = {
      schemaVersion: 1,
      lastSeenAt: now / 1000,
      credential: { entitlement: envelope, activationToken: 't'.repeat(43) },
    };
    const licensed = createLicensingRuntime(options);
    expect(await licensed.status()).toMatchObject({
      channel: 'commercial',
      edition: 'pro',
      tier: 'developer',
    });
    expect(licensed.proUnlocked()).toBe(true);
    saved = {
      ...saved,
      credential: {
        ...saved.credential!,
        entitlement: { ...envelope, signature: Buffer.alloc(64).toString('base64url') },
      },
    };
    expect(await createLicensingRuntime(options).status()).toMatchObject({ edition: 'free' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
