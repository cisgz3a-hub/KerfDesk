import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANUAL_DOWNLOAD_LATEST_KEY,
  manualDownloadKey,
  validateManualDownload,
} from '../public/desktop-manual-download.mjs';
import {
  platformArtifactNames,
  platformDownloadKey,
  platformDownloadUrl,
  platformLatestKey,
  platformLatestUrl,
  validatePlatformDownload,
  verifyPlatformDownload,
} from '../public/desktop-platform-download.mjs';
import { digest } from './commercial-release-manifest.mjs';
import { manualDownloadPayload, signManualDownload } from './manual-commercial-manifest.mjs';
import {
  platformDownloadPayload,
  publishPlatformCommercialRelease,
  signPlatformDownload,
} from './platform-commercial-publisher.mjs';
import {
  parsePlatformPublicationArguments,
  requirePlatformPublicationContext,
} from './publish-platform-commercial-release.mjs';
import * as stable from './commercial-release-test-support.mjs';

const VERSION = '1.2.3';
const PUBLISHED_AT = '2026-01-01T00:00:00.000Z';

function filesFor(platform, version = VERSION) {
  const files = new Map(
    platformArtifactNames(platform, version).map((name) => [name, Buffer.from(`bytes of ${name}`)]),
  );
  const expected = new Map([...files].map(([name, bytes]) => [name, digest(bytes)]));
  return { files, expected };
}

async function windowsManifest(identity) {
  const payload = manualDownloadPayload(identity, Buffer.from('windows installer'), stable.keySet);
  const envelope = await signManualDownload(
    payload,
    stable.privateKeyPem,
    stable.keyId,
    stable.keySet,
  );
  return Buffer.from(`${JSON.stringify(envelope)}\n`);
}

async function fixture(platform = 'macos', version = VERSION, publishedAt = PUBLISHED_AT) {
  const identity = stable.fixture(version, { publishedAt }).identity;
  const objects = new Map();
  const writes = [];
  const store = {
    get: async (key) => objects.get(key) ?? null,
    put: async (key, bytes, metadata) => {
      writes.push({ key, metadata });
      objects.set(key, Buffer.from(bytes));
    },
  };
  objects.set(
    manualDownloadKey(version, 'download-manifest.json'),
    await windowsManifest(identity),
  );
  return {
    identity,
    platform,
    ...filesFor(platform, version),
    store,
    objects,
    writes,
    keySet: stable.keySet,
    privateKeyPem: stable.privateKeyPem,
    keyId: stable.keyId,
  };
}

function payload(platform = 'macos', overrides = {}) {
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'platform-download',
    channel: 'stable',
    platform,
    version: VERSION,
    sourceSha: 'a'.repeat(40),
    sourceRef: 'refs/heads/main',
    publishedAt: PUBLISHED_AT,
    codeSigning: 'unsigned',
    updates: 'manual',
    artifacts: platformArtifactNames(platform, VERSION).map((name) => ({
      name,
      bytes: 10,
      sha256: 'b'.repeat(64),
    })),
    ...overrides,
  };
}

test('each system has its own exact files and storage keys beside the Windows ones', () => {
  assert.deepEqual(platformArtifactNames('macos', VERSION), [
    'KerfDesk-1.2.3-macos-arm64.dmg',
    'KerfDesk-1.2.3-macos-x64.dmg',
  ]);
  assert.deepEqual(platformArtifactNames('linux', VERSION), [
    'KerfDesk-1.2.3-linux-amd64.deb',
    'KerfDesk-1.2.3-linux-x86_64.AppImage',
  ]);
  assert.equal(platformLatestKey('macos'), 'desktop/commercial-manual/latest-macos.json');
  assert.equal(
    platformLatestUrl('linux'),
    'https://dl.kerfdesk.com/desktop/commercial-manual/latest-linux.json',
  );
  assert.notEqual(platformLatestKey('macos'), MANUAL_DOWNLOAD_LATEST_KEY);
  assert.equal(
    platformDownloadUrl('macos', VERSION, 'download-manifest-macos.json'),
    'https://dl.kerfdesk.com/desktop/commercial-manual/releases/1.2.3/download-manifest-macos.json',
  );
  for (const [platform, name] of [
    ['macos', 'download-manifest.json'],
    ['macos', 'KerfDesk-1.2.3-linux-amd64.deb'],
    ['linux', 'KerfDesk-1.2.3-windows-x64-setup.exe'],
    ['linux', '../latest.json'],
  ])
    assert.throws(() => platformDownloadKey(platform, VERSION, name));
  for (const platform of ['windows', 'win32', 'darwin', '', undefined])
    assert.throws(() => platformLatestKey(platform));
  for (const version of ['1.2', '01.2.3', '1.2.3-preview.1', '1.2.3/../x'])
    assert.throws(() => platformArtifactNames('macos', version));
});

test('the platform document accepts only its exact identity, system, files and signing values', () => {
  assert.equal(validatePlatformDownload(payload()).platform, 'macos');
  assert.equal(validatePlatformDownload(payload('linux')).platform, 'linux');
  assert.equal(
    validatePlatformDownload(payload('macos', { codeSigning: 'developer-id' })).platform,
    'macos',
  );
  const artifacts = payload().artifacts;
  for (const change of [
    { kind: 'manual-download' },
    { channel: 'preview' },
    { product: 'other' },
    { updates: 'automatic' },
    { platform: 'windows' },
    { codeSigning: 'authenticode' },
    { sourceRef: 'refs/heads/feature' },
    { sourceSha: 'A'.repeat(40) },
    { publishedAt: '2026-01-01T00:00:00Z' },
    { publishedAt: '2999-01-01T00:00:00.000Z' },
    { artifacts: artifacts.slice(0, 1) },
    { artifacts: [...artifacts].reverse() },
    { artifacts: [artifacts[0], artifacts[0]] },
    { artifacts: [{ ...artifacts[0], bytes: 0 }, artifacts[1]] },
    { artifacts: [{ ...artifacts[0], bytes: 300_000_001 }, artifacts[1]] },
    { artifacts: [{ ...artifacts[0], sha256: 'B'.repeat(64) }, artifacts[1]] },
    { artifacts: [{ ...artifacts[0], url: 'https://example.com' }, artifacts[1]] },
  ])
    assert.throws(() => validatePlatformDownload(payload('macos', change)), JSON.stringify(change));
  assert.throws(() => validatePlatformDownload(payload('linux', { codeSigning: 'developer-id' })));
  assert.throws(() => validatePlatformDownload({ ...payload(), extra: true }));
  const withoutPlatform = payload();
  delete withoutPlatform.platform;
  assert.throws(() => validatePlatformDownload(withoutPlatform));
});

test('installed Windows copies refuse a platform document, and a platform document names its system', async () => {
  // Installed Windows copies validate latest.json with validateManualDownload.
  assert.throws(() => validateManualDownload(payload()));
  assert.throws(() => validateManualDownload(payload('linux')));
  const envelope = await signPlatformDownload(
    payload('linux'),
    stable.privateKeyPem,
    stable.keyId,
    stable.keySet,
  );
  const text = JSON.stringify(envelope);
  assert.equal((await verifyPlatformDownload(text, stable.keySet, 'linux')).platform, 'linux');
  await assert.rejects(verifyPlatformDownload(text, stable.keySet, 'macos'));
  await assert.rejects(verifyPlatformDownload(text, { schemaVersion: 1, keys: [] }, 'linux'));
  await assert.rejects(
    verifyPlatformDownload(`${text}${' '.repeat(70_000)}`, stable.keySet, 'linux'),
  );
  const tampered = {
    ...envelope,
    payload: Buffer.from(JSON.stringify(payload('macos'))).toString('base64'),
  };
  await assert.rejects(verifyPlatformDownload(JSON.stringify(tampered), stable.keySet, 'macos'));
});

test('only files whose digests the qualifying job reported can be signed', async () => {
  const f = await fixture('linux');
  const signed = platformDownloadPayload(f.identity, 'linux', f.files, f.expected, f.keySet);
  assert.deepEqual(
    signed.artifacts.map(({ name }) => name),
    platformArtifactNames('linux', VERSION),
  );
  const changed = new Map(f.files);
  changed.set('KerfDesk-1.2.3-linux-amd64.deb', Buffer.from('changed after qualification'));
  assert.throws(() => platformDownloadPayload(f.identity, 'linux', changed, f.expected, f.keySet));
  const missing = new Map(f.files);
  missing.delete('KerfDesk-1.2.3-linux-x86_64.AppImage');
  assert.throws(() => platformDownloadPayload(f.identity, 'linux', missing, f.expected, f.keySet));
  const extra = new Map(f.files).set('KerfDesk-1.2.3-windows-x64-setup.exe', Buffer.from('x'));
  assert.throws(() => platformDownloadPayload(f.identity, 'linux', extra, f.expected, f.keySet));
  assert.throws(() => platformDownloadPayload(f.identity, 'macos', f.files, f.expected, f.keySet));
  const forged = { ...f.identity, signature: Buffer.alloc(64).toString('base64') };
  assert.throws(() => platformDownloadPayload(forged, 'linux', f.files, f.expected, f.keySet));
});

test('publication writes only its own system, files first and latest last, and never a Windows object', async () => {
  const f = await fixture('macos');
  const windowsBefore = new Map(f.objects);
  const result = await publishPlatformCommercialRelease(f);
  assert.equal(result.status, 'published');
  assert.deepEqual(
    f.writes.map(({ key }) => key),
    [
      'desktop/commercial-manual/releases/1.2.3/KerfDesk-1.2.3-macos-arm64.dmg',
      'desktop/commercial-manual/releases/1.2.3/KerfDesk-1.2.3-macos-x64.dmg',
      'desktop/commercial-manual/releases/1.2.3/download-manifest-macos.json',
      'desktop/commercial-manual/latest-macos.json',
    ],
  );
  assert.equal(f.writes.at(-1).metadata.cacheControl, 'no-store');
  assert.ok(
    f.writes.slice(0, -1).every(({ metadata }) => metadata.cacheControl.includes('immutable')),
  );
  for (const [key, bytes] of windowsBefore) assert.deepEqual(f.objects.get(key), bytes);
  assert.equal(f.objects.has(MANUAL_DOWNLOAD_LATEST_KEY), false);
  const latest = await verifyPlatformDownload(
    f.objects.get(platformLatestKey('macos')).toString(),
    stable.keySet,
    'macos',
  );
  assert.equal(latest.version, VERSION);
  assert.equal(latest.codeSigning, 'unsigned');
  assert.deepEqual(
    latest.artifacts.map(({ sha256 }) => sha256),
    [...f.expected.values()],
  );
  assert.deepEqual(
    f.objects.get(platformDownloadKey('macos', VERSION, 'download-manifest-macos.json')),
    f.objects.get(platformLatestKey('macos')),
  );
  // An exact retry after success changes nothing.
  f.writes.length = 0;
  assert.equal((await publishPlatformCommercialRelease(f)).status, 'already-published');
  assert.equal(f.writes.length, 0);
});

test('a system is never published before, or apart from, the Windows release of its version', async () => {
  const f = await fixture('linux');
  f.objects.clear();
  await assert.rejects(publishPlatformCommercialRelease(f), /Publish the Windows release 1\.2\.3/u);
  assert.equal(f.writes.length, 0);
  const other = stable.fixture(VERSION, { publishedAt: '2026-01-02T00:00:00.000Z' }).identity;
  f.objects.set(manualDownloadKey(VERSION, 'download-manifest.json'), await windowsManifest(other));
  await assert.rejects(publishPlatformCommercialRelease(f), /different release identity/u);
  f.objects.set(manualDownloadKey(VERSION, 'download-manifest.json'), Buffer.from('{}'));
  await assert.rejects(publishPlatformCommercialRelease(f), /cannot be verified/u);
  assert.equal(f.writes.length, 0);
});

test('publication refuses rollback, a conflicting version and changed immutable files', async () => {
  const newer = await fixture('macos', '1.2.4', '2026-01-02T00:00:00.000Z');
  await publishPlatformCommercialRelease(newer);
  const older = await fixture('macos');
  older.objects.set(platformLatestKey('macos'), newer.objects.get(platformLatestKey('macos')));
  await assert.rejects(publishPlatformCommercialRelease(older), /roll back/u);

  const conflict = await fixture('macos');
  await publishPlatformCommercialRelease(conflict);
  const rebuilt = filesFor('macos');
  rebuilt.files.set('KerfDesk-1.2.3-macos-x64.dmg', Buffer.from('a different build'));
  rebuilt.expected.set('KerfDesk-1.2.3-macos-x64.dmg', digest(Buffer.from('a different build')));
  await assert.rejects(publishPlatformCommercialRelease({ ...conflict, ...rebuilt }), /conflicts/u);

  const interrupted = await fixture('macos');
  interrupted.objects.set(
    platformDownloadKey('macos', VERSION, 'KerfDesk-1.2.3-macos-arm64.dmg'),
    Buffer.from('partial upload'),
  );
  await assert.rejects(publishPlatformCommercialRelease(interrupted), /Immutable/u);
  assert.equal(interrupted.writes.length, 0);

  const corrupt = await fixture('linux');
  corrupt.objects.set(platformLatestKey('linux'), Buffer.from('not signed'));
  await assert.rejects(publishPlatformCommercialRelease(corrupt), /cannot be verified/u);
});

test('publication stops when latest changes underneath it or a readback differs', async () => {
  const raced = await fixture('linux');
  const put = raced.store.put;
  raced.store.put = async (key, bytes, metadata) => {
    await put(key, bytes, metadata);
    if (key.endsWith('download-manifest-linux.json'))
      raced.objects.set(platformLatestKey('linux'), Buffer.from('another writer'));
  };
  await assert.rejects(publishPlatformCommercialRelease(raced), /changed during publication/u);

  const lossy = await fixture('linux');
  lossy.store.put = async (key, bytes) => {
    lossy.objects.set(key, Buffer.concat([Buffer.from(bytes), Buffer.from('x')]));
  };
  await assert.rejects(publishPlatformCommercialRelease(lossy), /readback failed/u);
});

test('the publication command takes one system, its qualified digests and no Windows-only context', () => {
  const sha = 'c'.repeat(64);
  const parsed = parsePlatformPublicationArguments([
    '--platform',
    'linux',
    '--sha256',
    `KerfDesk-1.2.3-linux-amd64.deb=${sha}`,
    '--sha256',
    `KerfDesk-1.2.3-linux-x86_64.AppImage=${sha}`,
    'release/commercial-unsigned/1.2.3',
    'identity.json',
  ]);
  assert.equal(parsed.platform, 'linux');
  assert.equal(parsed.expected.size, 2);
  assert.equal(parsed.releaseDirectory, 'release/commercial-unsigned/1.2.3');
  for (const args of [
    [],
    ['--platform', 'windows', '--sha256', `a=${sha}`, 'dir', 'id'],
    ['--platform', 'linux', 'dir', 'id'],
    ['--platform', 'linux', '--sha256', `a=${sha}`, 'dir'],
    ['--platform', 'linux', '--sha256', 'a=nothex', 'dir', 'id'],
    ['--platform', 'linux', '--sha256', `a=${sha}`, '--sha256', `a=${sha}`, 'dir', 'id'],
    ['--platform', 'linux', '--platform', 'macos', '--sha256', `a=${sha}`, 'dir', 'id'],
    ['--platform', 'linux', '--sha256', `a=${sha}`, '--force', 'dir', 'id'],
  ])
    assert.throws(() => parsePlatformPublicationArguments(args), JSON.stringify(args));
  const env = {
    DESKTOP_STABLE_MANIFEST_PRIVATE_KEY: 'key',
    DESKTOP_STABLE_MANIFEST_KEY_ID: 'stable-2026-09',
    COMMERCIAL_R2_API_TOKEN: 'token',
    COMMERCIAL_CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  };
  assert.doesNotThrow(() => requirePlatformPublicationContext(env));
  assert.throws(() => requirePlatformPublicationContext({ ...env, COMMERCIAL_R2_API_TOKEN: '' }));
  assert.throws(() =>
    requirePlatformPublicationContext({ ...env, COMMERCIAL_CLOUDFLARE_ACCOUNT_ID: 'x' }),
  );
});

test('the CI rehearsal replaces only the stable pin and signs an identity the lane accepts', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const { verifyCommercialEnvelope } = await import('./commercial-release-manifest.mjs');
  const { rehearsalIdentity, rehearsalKeySet } = await import('./rehearse-commercial-identity.mjs');
  const pinned = JSON.parse(
    await readFile(new URL('../public/desktop-release-keys.json', import.meta.url), 'utf8'),
  );
  const pair = generateKeyPairSync('ed25519');
  const spki = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const keySet = rehearsalKeySet(pinned, spki);
  assert.deepEqual(
    keySet.keys.filter((key) => key.channel !== 'stable'),
    pinned.keys.filter((key) => key.channel !== 'stable'),
  );
  assert.deepEqual(
    keySet.keys.filter((key) => key.channel === 'stable').map((key) => key.publicKeySpki),
    [spki],
  );
  const identity = rehearsalIdentity(
    { version: '0.0.42', sourceSha: 'd'.repeat(40), publishedAt: PUBLISHED_AT },
    pair.privateKey,
  );
  const claims = verifyCommercialEnvelope(identity, keySet, 'release-identity');
  assert.equal(claims.version, '0.0.42');
  assert.equal(claims.sourceRef, 'refs/heads/main');
  // The real pins never accept it, so nothing it signs can be published.
  assert.throws(() => verifyCommercialEnvelope(identity, pinned, 'release-identity'));
  assert.throws(() => rehearsalKeySet({ keys: 'none' }, spki));
});
