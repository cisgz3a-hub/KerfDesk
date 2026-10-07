import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createPackage } from '@electron/asar';
import { prepareCommercialMetadata } from './prepare-commercial-desktop.mjs';
import { digest } from './commercial-release-manifest.mjs';
import { commercialToolEnvironment } from './commercial-release-package.mjs';
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
const PAYLOAD = '$PLUGINSDIR/app-64.7z';
const PAYLOAD_BYTES = Buffer.from('Embedded x64 application archive');
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

function probe({
  status = 'NotSigned',
  outerListing = [PAYLOAD],
  listing = NAMES,
  payloadSize = PAYLOAD_BYTES.length,
  payloadBytes = PAYLOAD_BYTES,
  corrupt,
  fail,
} = {}) {
  const calls = [];
  const writes = [];
  let cleaned = false;
  const directory = join(tmpdir(), 'kerfdesk-unsigned-package-tool-test');
  const executable = join(directory, 'installer.exe');
  const archive = join(directory, 'app-64.7z');
  return {
    calls,
    writes,
    cleaned: () => cleaned,
    options: {
      resourceDigests: resources,
      archiveTool: async () => 'archive-tool',
      io: {
        mkdtemp: async () => directory,
        writeFile: async (path, bytes, options) => {
          assert.ok([executable, archive].includes(path));
          assert.ok(Buffer.isBuffer(bytes));
          assert.equal(options.flag, 'wx');
          writes.push(path);
          if (path === archive) assert.deepEqual(bytes, PAYLOAD_BYTES);
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
        if (args[0] === 'l') {
          const names = args.at(-1) === executable ? outerListing : listing;
          assert.ok([executable, archive].includes(args.at(-1)));
          return {
            stdout: names
              .map(
                (name) =>
                  `Path = ${name.replaceAll('/', '\\')}\r\nSize = ${name === PAYLOAD ? payloadSize : 1}\r\n`,
              )
              .join('\r\n'),
          };
        }
        const name = args.at(-1);
        if (name === PAYLOAD) {
          assert.equal(args.at(-2), executable);
          assert.equal(options.encoding, 'buffer');
          assert.equal(options.maxBuffer, payloadSize + 1);
          return { stdout: payloadBytes };
        }
        assert.equal(args.at(-2), archive);
        return { stdout: Buffer.from(name === corrupt ? 'Incorrect bytes' : name) };
      },
    },
  };
}

test('installer verification reads the NSIS x64 payload before verifying its resources and cleans up', async () => {
  const p = probe();
  await createUnsignedCommercialInstallerVerifier(p.options)(Buffer.from('Installer fixture'));
  assert.equal(p.cleaned(), true);
  assert.equal(p.calls.length, 9);
  assert.deepEqual(
    p.writes.map((path) => path.split(/[\\/]/u).at(-1)),
    ['installer.exe', 'app-64.7z'],
  );
  assert.ok(p.calls.every(({ program }) => program === 'pwsh' || program === 'archive-tool'));
  assert.deepEqual(
    p.calls
      .filter(({ args }) => args[0] === 'e' && args.at(-1) !== PAYLOAD)
      .map(({ args }) => args.at(-1))
      .sort(),
    [...NAMES].sort(),
  );
});

test('real nested archives verify resource bytes and reject tampering and updater feeds', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-unsigned-archive-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requireBuilder = createRequire(import.meta.resolve('electron-builder'));
  const tool = await requireBuilder('app-builder-lib/out/toolsets/7zip.js').getPath7za();
  const execute = promisify(execFile);
  const app = join(directory, 'app');
  const container = join(directory, 'container');
  await mkdir(join(app, 'resources/legal'), { recursive: true });
  await mkdir(join(container, '$PLUGINSDIR'), { recursive: true });
  for (const name of NAMES) await writeFile(join(app, name), name);
  const payload = join(container, '$PLUGINSDIR/app-64.7z');
  const installer = join(directory, 'installer.exe');
  const build = async () => {
    for (const [archive, cwd] of [
      [payload, app],
      [installer, container],
    ]) {
      await rm(archive, { force: true });
      await execute(tool, ['a', '-t7z', '-mx=0', archive, '.'], {
        cwd,
        env: commercialToolEnvironment(),
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 4_000_000,
      });
    }
    return readFile(installer);
  };
  const verify = createUnsignedCommercialInstallerVerifier({
    resourceDigests: resources,
    archiveTool: async () => tool,
    // The outer 7z models NSIS's named payload portably. Only the Windows
    // signature probe is substituted; listing and extraction use real tools.
    execute: (program, args, options) =>
      program === 'pwsh'
        ? Promise.resolve({ stdout: JSON.stringify({ status: 'NotSigned' }) })
        : execute(program, args, options),
  });
  await verify(await build());
  await writeFile(join(app, 'resources/app.asar'), Buffer.alloc('resources/app.asar'.length, 0));
  await assert.rejects(verify(await build()), /differs.*resources\/app\.asar/u);
  await writeFile(join(app, 'resources/app-update.yml'), 'provider: generic');
  await assert.rejects(verify(await build()), /update feed/u);
});

test('installer verification refuses missing, duplicate, wrong-architecture or unbounded payloads before writing them', async () => {
  for (const options of [
    { outerListing: NAMES },
    { outerListing: [PAYLOAD, PAYLOAD] },
    { outerListing: ['$PLUGINSDIR/app-32.7z'] },
    { outerListing: ['$PLUGINSDIR/app-arm64.7z'] },
    { outerListing: ['$PLUGINSDIR/app-64.zip'] },
    { outerListing: [PAYLOAD, '$PLUGINSDIR/app-arm64.7z'] },
    { outerListing: [PAYLOAD, 'resources/app-update.yml'] },
    { payloadSize: 0 },
    { payloadSize: -1 },
    { payloadSize: 300_000_001 },
    { payloadSize: 'unknown' },
    { payloadBytes: null },
    { payloadBytes: Buffer.alloc(0) },
    { payloadBytes: Buffer.from('Short payload') },
  ]) {
    const p = probe(options);
    await assert.rejects(
      createUnsignedCommercialInstallerVerifier(p.options)(Buffer.from('Installer fixture')),
    );
    assert.equal(p.cleaned(), true);
    assert.equal(p.writes.length, 1);
  }
});

test('a failing payload extraction or inner inspection still removes the owned verification directory', async () => {
  for (const [operation, name] of [
    ['e', PAYLOAD],
    ['l', 'app-64.7z'],
  ]) {
    const p = probe();
    const execute = p.options.execute;
    p.options.execute = async (program, args, options) => {
      if (args[0] === operation && args.at(-1).endsWith(name))
        throw new Error('Archive tool failed');
      return execute(program, args, options);
    };
    await assert.rejects(
      createUnsignedCommercialInstallerVerifier(p.options)(Buffer.from('Installer fixture')),
      /Archive tool failed/u,
    );
    assert.equal(p.cleaned(), true);
  }
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
