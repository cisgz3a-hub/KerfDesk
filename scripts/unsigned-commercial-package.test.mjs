import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';
import { createPackage } from '@electron/asar';
import { prepareCommercialMetadata } from './prepare-commercial-desktop.mjs';
import { digest } from './commercial-release-manifest.mjs';
import {
  readUnsignedCommercialPackage,
  createUnsignedCommercialInstallerVerifier,
} from './unsigned-commercial-package.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NAMES = [
  'KerfDesk.exe',
  'resources/app.asar',
  'resources/legal/LICENSE',
  'resources/legal/THIRD_PARTY_NOTICES.md',
  'resources/legal/third-party-notices.txt',
];
const resources = NAMES.map((name) => ({
  name,
  bytes: Buffer.byteLength(name),
  sha256: digest(Buffer.from(name)),
}));

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-unsigned-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const release = generateKeyPairSync('ed25519');
  const entitlement = generateKeyPairSync('ed25519');
  const keySet = {
    schemaVersion: 1,
    keys: [
      {
        keyId: 'stable-test',
        algorithm: 'Ed25519',
        channel: 'stable',
        publicKeySpki: release.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      },
    ],
  };
  const entitlementKeySet = {
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
  };
  const metadata = {
    ...prepareCommercialMetadata({
      unsignedInstaller: true,
      version: '1.2.3',
      sourceSha: 'a'.repeat(40),
      sourceRef: 'refs/tags/v1.2.3',
      publishedAt: '2026-09-30T01:00:00.000Z',
      keyId: 'stable-test',
      privateKeyPem: release.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      releaseKeySet: keySet,
      entitlementKeySet,
    }),
    ...overrides,
  };
  const app = join(directory, 'app');
  const packed = join(directory, 'packed');
  await mkdir(join(app, 'dist/web'), { recursive: true });
  await mkdir(join(app, 'dist-electron'), { recursive: true });
  await writeFile(join(app, 'dist-electron/main.js'), '');
  await writeFile(join(app, 'package.json'), JSON.stringify(metadata));
  await writeFile(
    join(app, 'dist/web/index.html'),
    '<meta name="kerfdesk-build-capabilities" content="desktop">',
  );
  const resourcesDirectory = join(packed, 'resources');
  await mkdir(join(resourcesDirectory, 'legal'), { recursive: true });
  await writeFile(join(packed, 'KerfDesk.exe'), 'Executable fixture');
  await finished(await createPackage(app, join(resourcesDirectory, 'app.asar')));
  for (const [source, destination] of [
    ['LICENSE', 'LICENSE'],
    ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
    ['public/third-party-notices.txt', 'third-party-notices.txt'],
  ])
    await writeFile(
      join(resourcesDirectory, 'legal', destination),
      await readFile(join(ROOT, source)),
    );
  return {
    resourcesDirectory,
    metadata,
    keySet,
    entitlementKeySet,
    read: () =>
      readUnsignedCommercialPackage(
        resourcesDirectory,
        metadata.kerfdeskCommercialLicense.release,
        keySet,
        entitlementKeySet,
      ),
  };
}

test('actual ASAR readback binds authentic unsigned metadata, executable and mandatory legal notices', async (t) => {
  const f = await fixture(t);
  const result = await f.read();
  assert.equal(result.metadata.kerfdeskCommercialLicense.apiOrigin, 'https://license.kerfdesk.com');
  assert.deepEqual(result.resourceDigests.map((entry) => entry.name).sort(), [...NAMES].sort());
  await writeFile(join(f.resourcesDirectory, 'app-update.yml'), 'provider: generic');
  await assert.rejects(f.read(), /update feed/u);
  await rm(join(f.resourcesDirectory, 'app-update.yml'));
  await writeFile(join(f.resourcesDirectory, 'legal/LICENSE'), 'Different notice');
  await assert.rejects(f.read(), /legal notice/u);
  const signed = await fixture(t, {
    kerfdeskUpdateChannelTrusted: true,
    kerfdeskDesktopReleaseChannel: 'stable',
  });
  await assert.rejects(signed.read(), /disable automatic updates/u);
});

function probe({ status = 'NotSigned', listing = NAMES, corrupt, fail } = {}) {
  const calls = [];
  let cleaned = false;
  const directory = join(tmpdir(), 'kerfdesk-unsigned-package-tool-test');
  return {
    calls,
    cleaned: () => cleaned,
    options: {
      resourceDigests: resources,
      archiveTool: async () => 'archive-tool',
      io: {
        mkdtemp: async () => directory,
        writeFile: async (path, bytes, options) => {
          assert.equal(path, join(directory, 'installer.exe'));
          assert.ok(Buffer.isBuffer(bytes));
          assert.equal(options.flag, 'wx');
        },
        rm: async (path) => {
          assert.equal(path, directory);
          cleaned = true;
        },
      },
      execute: async (program, args, options) => {
        calls.push({ program, args, options });
        assert.equal(options.windowsHide, true);
        assert.ok(options.timeout <= 120_000);
        assert.equal(options.env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY, undefined);
        if (fail) throw new Error('Tool failed');
        if (program === 'pwsh') return { stdout: JSON.stringify({ status }) };
        if (args[0] === 'l')
          return {
            stdout: listing
              .map((name) => `Path = ${name.replaceAll('/', '\\')}\r\nSize = 1\r\n`)
              .join('\r\n'),
          };
        const name = args.at(-1);
        return { stdout: Buffer.from(name === corrupt ? 'Incorrect bytes' : name) };
      },
    },
  };
}

test('installer verification reads exact archive resources without executing installer and cleans up', async () => {
  const p = probe();
  await createUnsignedCommercialInstallerVerifier(p.options)(Buffer.from('Installer fixture'));
  assert.equal(p.cleaned(), true);
  assert.equal(p.calls.length, 7);
  assert.ok(p.calls.every(({ program }) => program === 'pwsh' || program === 'archive-tool'));
  assert.deepEqual(
    p.calls
      .filter(({ args }) => args[0] === 'e')
      .map(({ args }) => args.at(-1))
      .sort(),
    [...NAMES].sort(),
  );
});

test('installer verification refuses updater feeds, missing/duplicate resources, altered bytes and unknown signature state', async () => {
  for (const options of [
    { status: 'Valid' },
    { status: 'UnknownError' },
    { listing: [...NAMES, 'resources/app-update.yml'] },
    { listing: [...NAMES, 'resources/APP-UPDATE.YML'] },
    { listing: [...NAMES, 'resources/app.asar'] },
    { listing: NAMES.slice(1) },
    { corrupt: 'resources/app.asar' },
    { corrupt: 'KerfDesk.exe' },
    { corrupt: 'resources/legal/THIRD_PARTY_NOTICES.md' },
    { fail: true },
  ]) {
    const p = probe(options);
    await assert.rejects(
      createUnsignedCommercialInstallerVerifier(p.options)(Buffer.from('Installer fixture')),
    );
    assert.equal(p.cleaned(), true);
  }
  for (const resourceDigests of [
    [],
    resources.slice(1),
    [...resources, resources[0]],
    resources.map((item) => ({ ...item, bytes: 0 })),
  ])
    assert.throws(
      () => createUnsignedCommercialInstallerVerifier({ resourceDigests }),
      /mandatory/u,
    );
});
