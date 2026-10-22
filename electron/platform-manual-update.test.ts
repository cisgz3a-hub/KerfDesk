// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPlatformManualUpdates } from './platform-manual-update.js';
import {
  manualUpdatePlatform,
  manualUpdatesOffered,
  verifyAnyManualDownload,
  manualReleaseKeySet,
} from './manual-update-manifest.js';
import { licensingConfigFromMetadata } from './licensing-config.js';
import { LicensingUpdateCache } from './licensing-update-cache.js';
import { officialPlatformDownloadUrl } from './official-download-page.js';

const key = generateKeyPairSync('ed25519');
const keys = { test: key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
const now = Date.parse('2026-10-20T00:00:00.000Z');

function envelope(payload: unknown): string {
  const data = Buffer.from(JSON.stringify(payload));
  return JSON.stringify({
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId: 'test',
    payload: data.toString('base64'),
    signature: sign(null, data, key.privateKey).toString('base64'),
  });
}

function release(platform: 'macos' | 'linux', version = '1.0.21', overrides = {}) {
  const files =
    platform === 'macos'
      ? [`KerfDesk-${version}-macos-arm64.dmg`, `KerfDesk-${version}-macos-x64.dmg`]
      : [`KerfDesk-${version}-linux-amd64.deb`, `KerfDesk-${version}-linux-x86_64.AppImage`];
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'platform-download',
    channel: 'stable',
    platform,
    version,
    sourceSha: 'a'.repeat(40),
    sourceRef: 'refs/heads/main',
    publishedAt: '2026-10-19T00:00:00.000Z',
    codeSigning: 'unsigned',
    updates: 'manual',
    artifacts: files.map((name) => ({ name, bytes: 100, sha256: 'b'.repeat(64) })),
    ...overrides,
  };
}

function harness(platform: 'macos' | 'linux' = 'macos') {
  let latest: () => Response = () => new Response(envelope(release(platform)));
  const fetch = vi.fn(async (url: string) =>
    url.endsWith(`latest-${platform}.json`) ? latest() : new Response('Not found', { status: 404 }),
  );
  const eligible = vi.fn(async () => true);
  const announce = vi.fn();
  const openDownloadPage = vi.fn(async () => undefined);
  const updates = createPlatformManualUpdates({
    platform,
    currentVersion: '1.0.20',
    currentPublishedAt: Date.parse('2026-10-18T00:00:00.000Z'),
    keys,
    fetch,
    eligible,
    announce,
    openDownloadPage,
    now: () => now,
  });
  const check = async () => {
    updates.check();
    await updates.settled();
    return updates.status();
  };
  return {
    updates,
    fetch,
    eligible,
    announce,
    openDownloadPage,
    check,
    serve: (next: () => Response) => {
      latest = next;
    },
  };
}

describe('macOS and Linux update notices (ADR-613)', () => {
  it('reads only its own system document and offers the download page, never a download', async () => {
    const h = harness('macos');
    const status = await h.check();
    expect(status).toMatchObject({
      mode: 'manual',
      delivery: 'download-page',
      installOnQuit: false,
      state: 'available',
      version: '1.0.21',
      releaseNotesState: 'unavailable',
    });
    expect(h.fetch.mock.calls[0]?.[0]).toBe(
      'https://dl.kerfdesk.com/desktop/commercial-manual/latest-macos.json',
    );
    expect(h.announce).toHaveBeenCalledOnce();
    await h.check();
    expect(h.announce).toHaveBeenCalledOnce();
    h.updates.download?.();
    await h.updates.settled();
    expect(h.openDownloadPage).toHaveBeenCalledWith(
      'https://kerfdesk.com/download.html?version=1.0.21#macos',
    );
    // Only the latest document and the release notes are ever fetched.
    expect(h.fetch.mock.calls.every(([url]) => !String(url).endsWith('.dmg'))).toBe(true);
    expect(h.updates.status().state).toBe('available');
    expect(h.updates.installOnQuit).toBeUndefined();
  });

  it('stays up to date when nothing newer is published, or nothing at all', async () => {
    const h = harness('linux');
    h.serve(() => new Response('Not found', { status: 404 }));
    expect((await h.check()).state).toBe('up-to-date');
    h.serve(() => new Response(envelope(release('linux', '1.0.20'))));
    expect((await h.check()).state).toBe('up-to-date');
    h.updates.download?.();
    await h.updates.settled();
    expect(h.openDownloadPage).not.toHaveBeenCalled();
  });

  it.each(['macos', 'linux'] as const)(
    'does not report up to date when the %s feed disappears after a verified update',
    async (platform) => {
      const h = harness(platform);
      expect(await h.check()).toMatchObject({ state: 'available', version: '1.0.21' });
      h.serve(() => new Response('Not found', { status: 404 }));
      expect((await h.check()).state).toBe('failed');
      expect(h.announce).toHaveBeenCalledOnce();
      h.serve(() => new Response(envelope(release(platform))));
      expect(await h.check()).toMatchObject({ state: 'available', version: '1.0.21' });
      h.updates.download?.();
      await h.updates.settled();
      expect(h.openDownloadPage).toHaveBeenCalledOnce();
      expect(h.announce).toHaveBeenCalledOnce();
    },
  );

  it('refuses another system, a forged, backdated or rolled-back document', async () => {
    for (const body of [
      envelope(release('linux')),
      envelope({ ...release('macos'), platform: 'linux' }),
      envelope(release('macos', '1.0.21', { publishedAt: '2026-10-01T00:00:00.000Z' })),
      envelope(release('macos', '1.0.21', { kind: 'manual-download' })),
      JSON.stringify({ ...JSON.parse(envelope(release('macos'))), keyId: 'other' }),
    ]) {
      const h = harness('macos');
      h.serve(() => new Response(body));
      expect((await h.check()).state).toBe('failed');
      expect(h.announce).not.toHaveBeenCalled();
    }
    const h = harness('macos');
    h.serve(() => new Response(envelope(release('macos', '1.0.22'))));
    expect((await h.check()).version).toBe('1.0.22');
    h.serve(() => new Response(envelope(release('macos', '1.0.21'))));
    expect((await h.check()).state).toBe('failed');
  });

  it('says not covered, and opens nothing, when the licence does not cover the release', async () => {
    const h = harness('linux');
    h.eligible.mockResolvedValue(false);
    expect((await h.check()).state).toBe('not-covered');
    h.updates.download?.();
    await h.updates.settled();
    expect(h.openDownloadPage).not.toHaveBeenCalled();
  });

  it('re-checks coverage before opening the page', async () => {
    const h = harness('macos');
    await h.check();
    h.eligible.mockResolvedValue(false);
    h.updates.download?.();
    await h.updates.settled();
    expect(h.openDownloadPage).not.toHaveBeenCalled();
    expect(h.updates.status().state).toBe('failed');
  });
});

describe('which commercial builds check for updates (ADR-613)', () => {
  function config() {
    const payload = { ...release('macos', '1.0.20'), kind: 'release-identity' } as Record<
      string,
      unknown
    >;
    for (const field of ['platform', 'codeSigning', 'updates', 'artifacts']) delete payload[field];
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

  it('maps each supported system and architecture to its document', () => {
    expect(manualUpdatePlatform('win32', 'x64')).toBe('windows');
    expect(manualUpdatePlatform('darwin', 'arm64')).toBe('macos');
    expect(manualUpdatePlatform('darwin', 'x64')).toBe('macos');
    expect(manualUpdatePlatform('linux', 'x64')).toBe('linux');
    for (const [platform, arch] of [
      ['win32', 'arm64'],
      ['linux', 'arm64'],
      ['freebsd', 'x64'],
    ] as const)
      expect(manualUpdatePlatform(platform, arch)).toBeNull();
    const value = config();
    const build = { packaged: true, platform: 'darwin', arch: 'arm64', version: '1.0.20' };
    expect(manualUpdatesOffered(value, build, keys)).toBe(true);
    expect(manualUpdatesOffered(value, { ...build, platform: 'linux', arch: 'x64' }, keys)).toBe(
      true,
    );
    expect(manualUpdatesOffered(value, { ...build, packaged: false }, keys)).toBe(false);
    expect(manualUpdatesOffered(value, { ...build, platform: 'linux', arch: 'arm64' }, keys)).toBe(
      false,
    );
  });

  it('applies licence update coverage to a macOS or Linux document', async () => {
    const cache = new LicensingUpdateCache(config(), () => now / 1000);
    cache.update({ schemaVersion: 1, lastSeenAt: now / 1000 }, 'device');
    for (const platform of ['macos', 'linux'] as const) {
      const text = envelope(release(platform));
      expect(await cache.manualEligible(text, '1.0.21')).toBe(true);
      expect(await cache.manualEligible(text, '1.0.22')).toBe(false);
      expect((await verifyAnyManualDownload(text, manualReleaseKeySet(keys), now)).version).toBe(
        '1.0.21',
      );
    }
    await expect(
      verifyAnyManualDownload(envelope({ kind: 'other' }), manualReleaseKeySet(keys), now),
    ).rejects.toThrow();
  });

  it('opens only one verified version section of the official download page', () => {
    expect(officialPlatformDownloadUrl('1.0.21', 'linux')).toBe(
      'https://kerfdesk.com/download.html?version=1.0.21#linux',
    );
    for (const version of ['1.0', '1.0.21-preview.1', '1.0.21&x=1', '01.0.0'])
      expect(() => officialPlatformDownloadUrl(version, 'macos')).toThrow();
    expect(() => officialPlatformDownloadUrl('1.0.21', 'windows' as 'macos')).toThrow();
  });
});
