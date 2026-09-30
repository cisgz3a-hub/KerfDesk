// @vitest-environment node
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManualUpdates } from './manual-update.js';
import { manualUpdatesOffered } from './manual-update-manifest.js';
import { licensingConfigFromMetadata } from './licensing-config.js';
import { updateChannelTrustedFromPackageMetadata } from './update-channel-trust.js';
import { LicensingUpdateCache } from './licensing-update-cache.js';
import { pruneManualInstallerCache } from './manual-update-download.js';

const key = generateKeyPairSync('ed25519');
const keys = { test: key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
const bytes = Buffer.from('verified fixture installer bytes');
const now = Date.parse('2026-10-01T00:00:00.000Z');
const folders: string[] = [];
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
function release(version = '1.0.1') {
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'manual-download',
    channel: 'stable',
    version,
    sourceSha: 'a'.repeat(40),
    sourceRef: 'refs/heads/main',
    publishedAt: '2026-09-30T23:00:00.000Z',
    codeSigning: 'unsigned',
    updates: 'manual',
    artifacts: [
      {
        name: `KerfDesk-${version}-windows-x64-setup.exe`,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
  };
}
async function harness() {
  const folder = await mkdtemp(join(tmpdir(), 'kerfdesk-manual-update-'));
  folders.push(folder);
  let manifest = envelope(release());
  let installer = () => new Response(bytes);
  const fetch = vi.fn(async (url: string) =>
    url.endsWith('latest.json') ? new Response(manifest) : installer(),
  );
  const eligible = vi.fn(async () => true);
  const announce = vi.fn();
  const updates = createManualUpdates({
    currentVersion: '1.0.0',
    currentPublishedAt: now - 86_400_000,
    userDataPath: folder,
    keys,
    fetch,
    eligible,
    announce,
    now: () => now,
  });
  const discover = async () => {
    updates.check();
    await updates.settled();
  };
  const download = async () => {
    await discover();
    updates.download?.();
    await updates.settled();
  };
  return {
    folder,
    updates,
    fetch,
    eligible,
    announce,
    discover,
    download,
    setManifest: (text: string) => {
      manifest = text;
    },
    setInstaller: (next: () => Response) => {
      installer = next;
    },
  };
}
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (dirname(folder) !== tmpdir()) throw new Error('Unexpected test directory');
    await rm(folder, { recursive: true, force: true });
  }
});

describe('authenticated manual desktop updates', () => {
  it('prunes only generated orphan filenames, preserving foreign files and directories', async () => {
    const h = await harness();
    await h.discover();
    const folder = join(h.folder, 'manual-updates');
    await mkdir(folder, { recursive: true });
    const owned = '1.0.1-12345678-1234-1234-1234-123456789abc.exe';
    await writeFile(join(folder, owned), bytes);
    await writeFile(join(folder, `${owned}.partial`), bytes);
    await writeFile(join(folder, 'personal.exe'), bytes);
    await mkdir(join(folder, '1.0.2-12345678-1234-1234-1234-123456789abc.exe'));
    await pruneManualInstallerCache(h.folder);
    expect((await readdir(folder)).sort()).toEqual([
      '1.0.2-12345678-1234-1234-1234-123456789abc.exe',
      'personal.exe',
    ]);
  });
  it('notifies once, downloads only explicitly and arms only after verification', async () => {
    const h = await harness();
    await h.discover();
    await h.discover();
    expect(h.updates.status()).toMatchObject({
      mode: 'manual',
      state: 'available',
      installOnQuit: false,
      version: '1.0.1',
    });
    expect(h.announce).toHaveBeenCalledOnce();
    expect(h.fetch.mock.calls.every(([url]) => url.endsWith('latest.json'))).toBe(true);
    expect(await h.updates.prepareInstall()).toBeNull();
    expect(h.updates.download?.().state).toBe('downloading');
    await h.updates.settled();
    expect(h.updates.status()).toMatchObject({ state: 'ready', installOnQuit: false });
    expect(await h.updates.prepareInstall()).toBeNull();
    expect(await h.updates.installOnQuit?.()).toMatchObject({
      state: 'ready',
      installOnQuit: true,
    });
    const file = await h.updates.prepareInstall();
    expect(await readFile(file!)).toEqual(bytes);
    expect(await h.updates.prepareInstall()).toBeNull();
    expect(h.fetch.mock.calls.at(-1)?.[0]).toBe(
      'https://dl.kerfdesk.com/desktop/commercial-manual/releases/1.0.1/KerfDesk-1.0.1-windows-x64-setup.exe',
    );
  });
  it.each(['arm', 'quit'])('rejects a staged installer changed before %s', async (phase) => {
    const h = await harness();
    await h.download();
    if (phase === 'quit') await h.updates.installOnQuit?.();
    const files = await readdir(join(h.folder, 'manual-updates'));
    await writeFile(join(h.folder, 'manual-updates', files[0]!), Buffer.alloc(bytes.length, 9));
    if (phase === 'arm') await h.updates.installOnQuit?.();
    else expect(await h.updates.prepareInstall()).toBeNull();
    expect(h.updates.status()).toMatchObject({ state: 'failed', installOnQuit: false });
    expect(await readdir(join(h.folder, 'manual-updates'))).toEqual([]);
  });
  it.each(['short', 'long', 'corrupt', 'redirect', 'header', 'http'])(
    'rejects %s downloads and removes partial files',
    async (failure) => {
      const h = await harness();
      h.setInstaller(() => {
        if (failure === 'short') return new Response(bytes.subarray(1));
        if (failure === 'long') return new Response(Buffer.concat([bytes, bytes]));
        if (failure === 'corrupt') return new Response(Buffer.alloc(bytes.length));
        if (failure === 'header')
          return new Response(bytes, { headers: { 'content-length': '999' } });
        if (failure === 'http') return new Response('unavailable', { status: 503 });
        const response = new Response(bytes);
        Object.defineProperty(response, 'url', { value: 'https://attacker.invalid/file.exe' });
        return response;
      });
      await h.download();
      expect(h.updates.status()).toMatchObject({ state: 'failed', installOnQuit: false });
      expect(await readdir(join(h.folder, 'manual-updates'))).toEqual([]);
    },
  );
  it('rejects tampered, wrong-purpose, future and backdated metadata', async () => {
    const h = await harness();
    for (const text of [
      envelope({ ...release(), kind: 'update-manifest' }),
      envelope({ ...release(), channel: 'preview' }),
      envelope({ ...release(), publishedAt: '2026-10-02T00:00:00.000Z' }),
      envelope({ ...release(), publishedAt: '2026-09-01T00:00:00.000Z' }),
      envelope(release()).replace('"signature":"', '"signature":"X'),
    ]) {
      h.setManifest(text);
      await h.discover();
      expect(h.updates.status().state).toBe('failed');
    }
    expect(h.announce).not.toHaveBeenCalled();
  });
  it('rejects an in-session rollback and same-version replacement', async () => {
    const h = await harness();
    await h.discover();
    h.setManifest(envelope(release('1.0.0')));
    await h.discover();
    expect(h.updates.status().state).toBe('failed');
    h.setManifest(envelope({ ...release(), sourceSha: 'b'.repeat(40) }));
    await h.discover();
    expect(h.updates.status().state).toBe('failed');
  });
  it('rechecks coverage after download and after arming', async () => {
    const h = await harness();
    await h.discover();
    h.eligible.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    h.updates.download?.();
    await h.updates.settled();
    expect(h.updates.status().state).toBe('failed');
    expect(await readdir(join(h.folder, 'manual-updates'))).toEqual([]);
    await h.download();
    await h.updates.installOnQuit?.();
    h.eligible.mockResolvedValue(false);
    expect(await h.updates.prepareInstall()).toBeNull();
  });
  it('does not overlap checks or downloads', async () => {
    const h = await harness();
    h.updates.check();
    h.updates.check();
    await h.updates.settled();
    h.updates.download?.();
    h.updates.download?.();
    await h.updates.settled();
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
});

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
