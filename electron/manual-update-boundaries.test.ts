// @vitest-environment node
import { sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { manualUpdatesOffered } from './manual-update-manifest.js';
import { licensingConfigFromMetadata } from './licensing-config.js';
import { updateChannelTrustedFromPackageMetadata } from './update-channel-trust.js';
import { LicensingUpdateCache } from './licensing-update-cache.js';
import { envelope, key, keys, now, release } from './manual-update.test-support.js';

describe('manual update build and licence boundaries', () => {
  function config() {
    const payload = { ...release('1.0.0'), kind: 'release-identity' };
    return licensingConfigFromMetadata({
      kerfdeskUnsignedInstaller: true,
      kerfdeskUpdateChannelTrusted: false,
      kerfdeskDesktopReleaseChannel: 'commercial-unsigned',
      kerfdeskCommercialLicense: {
        schema: 1,
        apiOrigin: 'https://license.kerfdesk.com',
        entitlementKeys: keys,
        releaseKeys: keys,
        release: JSON.parse(envelope(payload)),
      },
    });
  }
  it('requires exact package mode, Windows x64, version and independent keys', () => {
    const value = config();
    const build = { packaged: true, platform: 'win32', arch: 'x64', version: '1.0.0' };
    expect(manualUpdatesOffered(value, build, keys)).toBe(true);
    expect(manualUpdatesOffered(value, { ...build, packaged: false }, keys)).toBe(false);
    expect(manualUpdatesOffered(value, { ...build, arch: 'arm64' }, keys)).toBe(false);
    expect(manualUpdatesOffered(value, { ...build, version: '1.0.2' }, keys)).toBe(false);
    expect(manualUpdatesOffered(value, build, { other: keys.test })).toBe(false);
    expect(
      updateChannelTrustedFromPackageMetadata({
        kerfdeskUpdateChannelTrusted: true,
        kerfdeskUnsignedInstaller: true,
      }),
    ).toBe(false);
  });
  it('allows Free manual updates only after signature verification and never via signed update API', async () => {
    const cache = new LicensingUpdateCache(config(), () => now / 1000);
    cache.update({ schemaVersion: 1, lastSeenAt: now / 1000 }, 'device');
    const text = envelope(release());
    expect(await cache.manualEligible(text, '1.0.1')).toBe(true);
    expect(cache.eligible(JSON.parse(text), '1.0.1')).toBe(false);
    expect(await cache.manualEligible(text, '1.0.2')).toBe(false);
    cache.failAuthentication();
    expect(await cache.manualEligible(text, '1.0.1')).toBe(false);
  });
  it.each([
    ['paid-covered', true],
    ['paid-expired', false],
    ['trial-expired', true],
    ['developer', true],
  ] as const)('preserves %s update rights', async (kind, expected) => {
    const device = 'd'.repeat(43);
    const end = kind === 'paid-covered' ? now / 1000 : now / 1000 - 7200;
    const claims = {
      schemaVersion: 1,
      product: 'kerfdesk-desktop',
      licenseId: 'licence',
      activationId: 'activation',
      deviceId: device,
      tier: kind === 'developer' ? 'developer' : kind === 'trial-expired' ? 'trial' : 'paid',
      issuedAt: now / 1000 - 86_400,
      accessExpiresAt: kind === 'trial-expired' ? end : null,
      updatesUntil: kind === 'developer' ? null : end,
      perpetualUpdates: kind === 'developer',
      maxDevices: 3,
    };
    const data = Buffer.from(JSON.stringify(claims));
    const entitlement = {
      keyId: 'test',
      payload: data.toString('base64url'),
      signature: sign(null, data, key.privateKey).toString('base64url'),
    };
    const cache = new LicensingUpdateCache(config(), () => now / 1000);
    cache.update(
      {
        schemaVersion: 1,
        lastSeenAt: now / 1000,
        credential: { entitlement, activationToken: Buffer.alloc(32, 1).toString('base64url') },
      },
      device,
    );
    expect(await cache.manualEligible(envelope(release()), '1.0.1')).toBe(expected);
    cache.beginMutation();
    expect(await cache.manualEligible(envelope(release()), '1.0.1')).toBe(false);
  });
});
