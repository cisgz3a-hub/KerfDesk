import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPackage } from '@electron/asar';
import { finished } from 'node:stream/promises';
import ts from 'typescript';
import verifyCommercialPackage, {
  prepareCommercialMetadata,
  publicKeyRecord,
  runPreparation,
  verifyCommercialMetadata,
  verifyUnsignedCommercialMetadata,
  verifyUnsignedCommercialPackage,
  writeCommercialPreparation,
} from './prepare-commercial-desktop.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TIMESTAMP = '2026-09-28T12:00:00.000Z';
const key = () => {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicKeySpki: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
};

function fixture(overrides = {}) {
  const stable = key();
  const preview = key();
  const entitlement = key();
  return {
    version: '1.2.3',
    sourceSha: 'a'.repeat(40),
    sourceRef: 'refs/tags/v1.2.3',
    publishedAt: TIMESTAMP,
    keyId: 'stable-test',
    privateKeyPem: stable.privateKeyPem,
    entitlementKeySet: {
      schemaVersion: 1,
      keys: [
        {
          keyId: 'entitlement-test',
          algorithm: 'Ed25519',
          publicKeySpki: entitlement.publicKeySpki,
        },
      ],
    },
    releaseKeySet: {
      schemaVersion: 1,
      keys: [
        {
          keyId: 'preview-test',
          algorithm: 'Ed25519',
          channel: 'preview',
          publicKeySpki: preview.publicKeySpki,
        },
        {
          keyId: 'stable-test',
          algorithm: 'Ed25519',
          channel: 'stable',
          publicKeySpki: stable.publicKeySpki,
        },
      ],
    },
    ...overrides,
  };
}

async function files() {
  // The preparation resolves real paths; macOS's /var link and Windows's short
  // RUNNER~1 temp name would otherwise differ from the paths asserted here.
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'kerfdesk-commercial-prep-')));
  const root = join(workspace, 'repository');
  const outputDir = join(workspace, 'generated');
  const termsFile = join(workspace, 'approved-terms-fixture.txt');
  await mkdir(root);
  await writeFile(termsFile, 'Synthetic terms for packaging tests only.');
  return { root, outputDir, termsFile, workspace };
}

async function runtimeVerification() {
  const source = await readFile(
    new URL('../electron/licensing-verification.ts', import.meta.url),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

test('prebuild release identity passes actual Electron verifier with standard base64 and stable-only pins', async () => {
  const input = fixture();
  const metadata = prepareCommercialMetadata(input);
  const commercial = metadata.kerfdeskCommercialLicense;
  const { verifyLicenceRelease } = await runtimeVerification();
  assert.deepEqual(verifyLicenceRelease(commercial.release, commercial.releaseKeys), {
    version: '1.2.3',
    publishedAt: Date.parse(TIMESTAMP) / 1000,
  });
  assert.deepEqual(Object.keys(commercial.releaseKeys), ['stable-test']);
  assert.deepEqual(Object.keys(commercial.entitlementKeys), ['entitlement-test']);
  assert.equal(commercial.apiOrigin, 'https://license.kerfdesk.com');
  assert.equal(metadata.version, '1.2.3');
  const identity = verifyCommercialMetadata(metadata, input.entitlementKeySet, input.releaseKeySet);
  assert.deepEqual(
    Object.keys(identity).sort(),
    [
      'schemaVersion',
      'product',
      'kind',
      'channel',
      'version',
      'sourceSha',
      'sourceRef',
      'publishedAt',
    ].sort(),
  );
  assert.equal(identity.kind, 'release-identity');
  assert.equal(JSON.stringify(metadata).includes('PRIVATE KEY'), false);
});

test('invalid release identity, Preview keys, key reuse and wrong private signing key are rejected', () => {
  const input = fixture();
  for (const changes of [
    { version: '1.2.3-preview.1' },
    { version: '01.2.3' },
    { sourceSha: 'A'.repeat(40) },
    { sourceRef: 'unsafe\nref' },
    { sourceRef: '' },
    { publishedAt: '2026-09-28T12:00:00Z' },
    { publishedAt: 'invalid' },
    { keyId: 'preview-test' },
    { privateKeyPem: key().privateKeyPem },
  ])
    assert.throws(() => prepareCommercialMetadata({ ...input, ...changes }));
});

test('preparation refuses the identities the publisher refuses: another ref or a future date', () => {
  const input = fixture();
  const now = Date.parse(TIMESTAMP);
  for (const sourceRef of ['refs/heads/feature', 'refs/tags/v1.2.4', 'refs/tags/1.2.3', 'v1.2.3'])
    assert.throws(
      () => prepareCommercialMetadata({ ...input, sourceRef }, now),
      /\(Invalid commercial release: source\): the source ref must be refs\/tags\/v1\.2\.3, or refs\/heads\/main for the release train/u,
    );
  // The release train builds main and never tags (ADR-541).
  assert.equal(
    prepareCommercialMetadata({ ...input, sourceRef: 'refs/heads/main' }, now).version,
    '1.2.3',
  );
  assert.equal(
    prepareCommercialMetadata({ ...input, publishedAt: '2026-09-28T12:05:00.000Z' }, now).version,
    '1.2.3',
  );
  for (const [publishedAt, clock] of [
    ['2026-09-28T12:05:00.001Z', now],
    ['2099-01-01T00:00:00.000Z', undefined],
  ])
    assert.throws(
      () => prepareCommercialMetadata({ ...input, publishedAt }, clock),
      /\(Invalid commercial release: publication timestamp\)/u,
    );
  assert.throws(() =>
    prepareCommercialMetadata({
      ...input,
      entitlementKeySet: {
        schemaVersion: 1,
        keys: [
          {
            ...input.entitlementKeySet.keys[0],
            publicKeySpki: input.releaseKeySet.keys[1].publicKeySpki,
          },
        ],
      },
    }),
  );
  assert.throws(() =>
    publicKeyRecord(
      { schemaVersion: 1, keys: [input.releaseKeySet.keys[1], input.releaseKeySet.keys[1]] },
      'stable',
    ),
  );
});

test('tampered payload, swapped pins, wrong package version and missing marker fail verification', async () => {
  const input = fixture();
  const metadata = prepareCommercialMetadata(input);
  const { verifyLicenceRelease } = await runtimeVerification();
  const tampered = structuredClone(metadata);
  const payload = JSON.parse(
    Buffer.from(tampered.kerfdeskCommercialLicense.release.payload, 'base64'),
  );
  payload.publishedAt = '2025-01-01T00:00:00.000Z';
  tampered.kerfdeskCommercialLicense.release.payload = Buffer.from(
    JSON.stringify(payload),
  ).toString('base64');
  assert.equal(
    verifyLicenceRelease(
      tampered.kerfdeskCommercialLicense.release,
      tampered.kerfdeskCommercialLicense.releaseKeys,
    ),
    null,
  );
  for (const broken of [
    tampered,
    { ...metadata, version: '1.2.4' },
    {},
    { ...metadata, kerfdeskCommercialLicense: { schema: 0 } },
    { ...metadata, kerfdeskUpdateChannelTrusted: false },
  ])
    assert.throws(() =>
      verifyCommercialMetadata(broken, input.entitlementKeySet, input.releaseKeySet),
    );
  const swapped = structuredClone(metadata);
  swapped.kerfdeskCommercialLicense.releaseKeys['preview-test'] =
    input.releaseKeySet.keys[0].publicKeySpki;
  assert.throws(() =>
    verifyCommercialMetadata(swapped, input.entitlementKeySet, input.releaseKeySet),
  );
});

test('external preparation is idempotent, leaves root package unchanged, and requires explicit terms', async () => {
  const paths = await files();
  const input = { ...fixture(), ...paths };
  const original = '{"name":"untouched","version":"0.1.0"}\n';
  await writeFile(join(paths.root, 'package.json'), original);
  const result = await writeCommercialPreparation(input, paths.root);
  assert.deepEqual(await writeCommercialPreparation(input, paths.root), result);
  const config = JSON.parse(await readFile(result.configPath, 'utf8'));
  assert.equal(config.extends, join(paths.root, 'electron-builder.commercial.yml'));
  assert.equal(config.nsis.license, result.termsPath);
  assert.deepEqual(
    JSON.parse(await readFile(result.identityPath, 'utf8')),
    config.extraMetadata.kerfdeskCommercialLicense.release,
  );
  assert.equal(await readFile(join(paths.root, 'package.json'), 'utf8'), original);
  await assert.rejects(
    writeCommercialPreparation(
      { ...input, version: '1.2.4', sourceRef: 'refs/tags/v1.2.4' },
      paths.root,
    ),
    /different contents/u,
  );
  await assert.rejects(
    writeCommercialPreparation({ ...input, outputDir: join(paths.root, 'unsafe') }, paths.root),
    /outside/u,
  );
  await assert.rejects(
    writeCommercialPreparation(
      { ...input, outputDir: join(paths.root, '..looks-external') },
      paths.root,
    ),
    /outside/u,
  );
  await writeFile(paths.termsFile, '  \n');
  await assert.rejects(writeCommercialPreparation(input, paths.root), /nonempty/u);
  await writeFile(paths.termsFile, Buffer.from([255]));
  await assert.rejects(writeCommercialPreparation(input, paths.root));
});

test('CLI sources private key only from explicit protected env or file and never writes it', async () => {
  const paths = await files();
  const input = fixture();
  await mkdir(join(paths.root, 'public'));
  await writeFile(
    join(paths.root, 'public/desktop-licence-keys.json'),
    JSON.stringify(input.entitlementKeySet),
  );
  await writeFile(
    join(paths.root, 'public/desktop-release-keys.json'),
    JSON.stringify(input.releaseKeySet),
  );
  const keyFile = join(paths.workspace, 'private.pem');
  await writeFile(keyFile, input.privateKeyPem, { mode: 0o600 });
  const args = [
    '--output-dir',
    paths.outputDir,
    '--terms-file',
    paths.termsFile,
    '--version',
    input.version,
    '--source-sha',
    input.sourceSha,
    '--source-ref',
    input.sourceRef,
    '--published-at',
    input.publishedAt,
    '--key-id',
    input.keyId,
  ];
  await assert.rejects(runPreparation(args, {}, paths.root), /exactly one/u);
  await assert.rejects(
    runPreparation(
      args,
      {
        DESKTOP_STABLE_MANIFEST_PRIVATE_KEY: input.privateKeyPem,
        DESKTOP_STABLE_MANIFEST_PRIVATE_KEY_FILE: keyFile,
      },
      paths.root,
    ),
    /exactly one/u,
  );
  const branch = args.map((value) => (value === input.sourceRef ? 'refs/heads/feature' : value));
  await assert.rejects(
    runPreparation(branch, { DESKTOP_STABLE_MANIFEST_PRIVATE_KEY_FILE: keyFile }, paths.root),
    /publisher would refuse/u,
  );
  await assert.rejects(access(paths.outputDir));
  const result = await runPreparation(
    args,
    { DESKTOP_STABLE_MANIFEST_PRIVATE_KEY_FILE: keyFile },
    paths.root,
  );
  for (const path of [result.configPath, result.identityPath]) {
    const content = await readFile(path, 'utf8');
    assert.equal(content.includes(input.privateKeyPem), false);
    assert.equal(content.includes(keyFile), false);
  }
  const unsigned = await runPreparation(
    ['--unsigned-installer', ...args],
    { DESKTOP_STABLE_MANIFEST_PRIVATE_KEY_FILE: keyFile },
    paths.root,
  );
  const unsignedConfig = JSON.parse(await readFile(unsigned.configPath, 'utf8'));
  assert.equal(unsignedConfig.extraMetadata.kerfdeskUnsignedInstaller, true);
  assert.equal(unsignedConfig.extraMetadata.kerfdeskUpdateChannelTrusted, false);
  assert.equal(
    unsignedConfig.extends,
    join(paths.root, 'electron-builder.commercial-unsigned.yml'),
  );
  await assert.rejects(
    runPreparation(['--unsigned-installer', '--unsigned-installer', ...args], {}, paths.root),
    /Duplicate/u,
  );
});

for (const unsignedInstaller of [false, true])
  test(`${unsignedInstaller ? 'unsigned' : 'signed'} preparation marks UTF-8 terms without changing approved text`, async () => {
    const paths = await files();
    const input = { ...fixture({ unsignedInstaller }), ...paths };
    const original = Buffer.from('Safety — read carefully.\r\nLiability — café 中文.\n');
    await writeFile(paths.termsFile, original);
    const result = await writeCommercialPreparation(input, paths.root);
    const encoded = await readFile(result.termsPath);
    assert.deepEqual(encoded.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
    assert.deepEqual(encoded.subarray(3), original);
    assert.equal(
      new TextDecoder('utf-8', { fatal: true }).decode(encoded),
      original.toString('utf8'),
    );
    assert.deepEqual(await readFile(paths.termsFile), original);
    assert.deepEqual(await writeCommercialPreparation(input, paths.root), result);
    await writeFile(paths.termsFile, 'Different approved text.');
    await assert.rejects(writeCommercialPreparation(input, paths.root), /different contents/u);
    assert.deepEqual(await readFile(result.termsPath), encoded);
  });

test('afterPack verifies actual ASAR metadata and explicit external terms before code signing', async () => {
  const paths = await files();
  const input = fixture();
  await mkdir(join(paths.root, 'public'));
  await writeFile(
    join(paths.root, 'public/desktop-licence-keys.json'),
    JSON.stringify(input.entitlementKeySet),
  );
  await writeFile(
    join(paths.root, 'public/desktop-release-keys.json'),
    JSON.stringify(input.releaseKeySet),
  );
  const appOutDir = join(paths.workspace, 'packed');
  const app = join(paths.workspace, 'app');
  await mkdir(join(appOutDir, 'resources'), { recursive: true });
  await mkdir(app);
  await mkdir(join(app, 'dist/web'), { recursive: true });
  await mkdir(join(app, 'dist-electron'), { recursive: true });
  await writeFile(join(app, 'dist-electron/main.js'), '');
  await writeFile(
    join(app, 'dist/web/index.html'),
    '<meta name="kerfdesk-build-capabilities" content="desktop">',
  );
  await writeFile(join(app, 'package.json'), JSON.stringify(prepareCommercialMetadata(input)));
  await finished(await createPackage(app, join(appOutDir, 'resources/app.asar')));
  const context = {
    electronPlatformName: 'win32',
    appOutDir,
    packager: {
      projectDir: paths.root,
      appInfo: { version: input.version },
      config: { nsis: { license: paths.termsFile } },
    },
  };
  await verifyCommercialPackage(context);
  await assert.rejects(
    verifyCommercialPackage({ ...context, electronPlatformName: 'darwin' }),
    /Windows/u,
  );
  await assert.rejects(
    verifyCommercialPackage({
      ...context,
      packager: { ...context.packager, appInfo: { version: '1.2.4' } },
    }),
    /version/u,
  );
  await assert.rejects(
    verifyCommercialPackage({
      ...context,
      packager: { ...context.packager, config: { nsis: { license: 'public/eula.txt' } } },
    }),
    /terms/u,
  );
  for (const mode of ['browser-free', 'missing']) {
    const brokenOut = join(paths.workspace, mode);
    await mkdir(join(brokenOut, 'resources'), { recursive: true });
    await writeFile(
      join(app, 'dist/web/index.html'),
      mode === 'missing'
        ? '<html></html>'
        : `<meta name="kerfdesk-build-capabilities" content="${mode}">`,
    );
    await finished(await createPackage(app, join(brokenOut, 'resources/app.asar')));
    await assert.rejects(
      verifyCommercialPackage({ ...context, appOutDir: brokenOut }),
      /desktop renderer/u,
    );
  }
});

test('installed builder resolves commercial inheritance with mandatory signing and dedicated feed', async () => {
  const requireBuilder = createRequire(import.meta.resolve('electron-builder'));
  const { getConfig } = await import(
    pathToFileURL(requireBuilder.resolve('app-builder-lib/out/util/config/config.js')).href
  );
  const config = await getConfig(ROOT, join(ROOT, 'electron-builder.commercial.yml'), null);
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.win.verifyUpdateCodeSignature, true);
  assert.equal(config.publish.url, 'https://dl.kerfdesk.com/desktop/commercial');
  assert.equal(config.extraMetadata.kerfdeskCommercialLicense.schema, 0);
  assert.equal(config.nsis.license, 'COMMERCIAL-TERMS-MUST-BE-PROVIDED.txt');
  assert.ok(config.files.some((entry) => entry.filter?.includes('dist-electron/**/*')));
  const free = await getConfig(ROOT, join(ROOT, 'electron-builder.yml'), null);
  const preview = await getConfig(ROOT, join(ROOT, 'electron-builder.preview.yml'), null);
  assert.equal(free.extraMetadata?.kerfdeskCommercialLicense, undefined);
  assert.equal(preview.extraMetadata.kerfdeskCommercialLicense, undefined);
  assert.notEqual(free.publish.url, config.publish.url);
  const paths = await files();
  const generated = await writeCommercialPreparation({ ...fixture(), ...paths }, ROOT);
  const effective = await getConfig(ROOT, generated.configPath, null);
  assert.equal(effective.extraMetadata.kerfdeskCommercialLicense.schema, 1);
  assert.equal(effective.extraMetadata.version, '1.2.3');
  assert.equal(effective.nsis.license, generated.termsPath);
  assert.equal(effective.forceCodeSigning, true);
  assert.equal(effective.publish.url, 'https://dl.kerfdesk.com/desktop/commercial');
});

test('unsigned preparation keeps production signatures and pins, and cannot enter signed publisher', async () => {
  const input = fixture({ unsignedInstaller: true });
  const metadata = prepareCommercialMetadata(input);
  assert.equal(metadata.kerfdeskUnsignedInstaller, true);
  assert.equal(metadata.kerfdeskDesktopReleaseChannel, 'commercial-unsigned');
  assert.equal(metadata.kerfdeskUpdateChannelTrusted, false);
  assert.equal(metadata.kerfdeskCommercialLicense.apiOrigin, 'https://license.kerfdesk.com');
  assert.equal(
    verifyUnsignedCommercialMetadata(metadata, input.entitlementKeySet, input.releaseKeySet)
      .version,
    input.version,
  );
  const { verifyLicenceRelease } = await runtimeVerification();
  assert.equal(
    verifyLicenceRelease(
      metadata.kerfdeskCommercialLicense.release,
      metadata.kerfdeskCommercialLicense.releaseKeys,
    ).version,
    input.version,
  );
  for (const changes of [
    {},
    { kerfdeskUpdateChannelTrusted: true, kerfdeskDesktopReleaseChannel: 'stable' },
  ])
    assert.throws(
      () =>
        verifyCommercialMetadata(
          { ...metadata, ...changes },
          input.entitlementKeySet,
          input.releaseKeySet,
        ),
      /trust/u,
    );
  for (const changes of [
    { kerfdeskUpdateChannelTrusted: true },
    { kerfdeskDesktopReleaseChannel: 'preview' },
    { kerfdeskUnsignedInstaller: undefined },
    { kerfdeskSandbox: true },
    {
      kerfdeskCommercialLicense: {
        ...metadata.kerfdeskCommercialLicense,
        apiOrigin: 'https://example.com',
      },
    },
    {
      kerfdeskCommercialLicense: {
        ...metadata.kerfdeskCommercialLicense,
        entitlementKeys: { fixture: key().publicKeySpki },
      },
    },
    {
      kerfdeskCommercialLicense: {
        ...metadata.kerfdeskCommercialLicense,
        release: {
          ...metadata.kerfdeskCommercialLicense.release,
          signature: Buffer.alloc(64).toString('base64'),
        },
      },
    },
  ])
    assert.throws(() =>
      verifyUnsignedCommercialMetadata(
        { ...metadata, ...changes },
        input.entitlementKeySet,
        input.releaseKeySet,
      ),
    );
  assert.throws(
    () => prepareCommercialMetadata({ ...input, unsignedInstaller: 'true' }),
    /explicit/u,
  );
});

test('unsigned generated config disables signing and feeds while preserving customer resources', async () => {
  const paths = await files();
  const result = await writeCommercialPreparation(
    { ...fixture(), ...paths, unsignedInstaller: true },
    ROOT,
  );
  const requireBuilder = createRequire(import.meta.resolve('electron-builder'));
  const { getConfig } = await import(
    pathToFileURL(requireBuilder.resolve('app-builder-lib/out/util/config/config.js')).href
  );
  const config = await getConfig(ROOT, result.configPath, null);
  assert.equal(config.appId, 'dev.laserforge.app');
  assert.equal(config.productName, 'KerfDesk');
  assert.equal(config.forceCodeSigning, false);
  assert.equal(config.win.signExecutable, false);
  assert.notEqual(config.win.signAndEditExecutable, false);
  assert.equal(config.win.verifyUpdateCodeSignature, true);
  assert.equal(config.publish, null);
  assert.equal(config.nsis.differentialPackage, false);
  assert.equal(config.nsis.license, result.termsPath);
  assert.equal(config.extraMetadata.kerfdeskCommercialLicense.schema, 1);
  assert.equal(config.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.ok(config.extraResources.some((entry) => entry.to === 'legal/THIRD_PARTY_NOTICES.md'));
  assert.ok(config.fileAssociations.some((entry) => entry.ext === 'lf2'));
});

test('unsigned afterPack validates production ASAR, renderer, notices and actual effective config', async () => {
  const paths = await files();
  const input = fixture({ unsignedInstaller: true });
  const metadata = prepareCommercialMetadata(input);
  const app = join(paths.workspace, 'app');
  const appOutDir = join(paths.workspace, 'packed');
  await mkdir(join(paths.root, 'public'));
  await writeFile(
    join(paths.root, 'public/desktop-licence-keys.json'),
    JSON.stringify(input.entitlementKeySet),
  );
  await writeFile(
    join(paths.root, 'public/desktop-release-keys.json'),
    JSON.stringify(input.releaseKeySet),
  );
  await mkdir(join(app, 'dist/web'), { recursive: true });
  await mkdir(join(app, 'dist-electron'), { recursive: true });
  await writeFile(join(app, 'dist-electron/main.js'), '');
  await writeFile(
    join(app, 'dist/web/index.html'),
    '<meta name="kerfdesk-build-capabilities" content="desktop">',
  );
  await writeFile(join(app, 'package.json'), JSON.stringify(metadata));
  await mkdir(join(appOutDir, 'resources/legal'), { recursive: true });
  for (const [source, destination] of [
    ['LICENSE', 'LICENSE'],
    ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
    ['public/third-party-notices.txt', 'third-party-notices.txt'],
  ]) {
    await writeFile(join(paths.root, source), 'Notice fixture');
    await writeFile(join(appOutDir, 'resources/legal', destination), 'Notice fixture');
  }
  await finished(await createPackage(app, join(appOutDir, 'resources/app.asar')));
  const config = {
    appId: 'dev.laserforge.app',
    productName: 'KerfDesk',
    forceCodeSigning: false,
    win: { signExecutable: false },
    publish: null,
    nsis: { license: paths.termsFile, differentialPackage: false },
  };
  const context = {
    electronPlatformName: 'win32',
    appOutDir,
    packager: { projectDir: paths.root, appInfo: { version: input.version }, config },
  };
  await verifyUnsignedCommercialPackage(context);
  for (const changes of [
    { forceCodeSigning: true },
    { publish: { provider: 'generic', url: 'https://dl.kerfdesk.com/desktop/commercial' } },
    { win: { signExecutable: true } },
    { appId: 'dev.kerfdesk.sandbox' },
  ])
    await assert.rejects(
      verifyUnsignedCommercialPackage({
        ...context,
        packager: { ...context.packager, config: { ...config, ...changes } },
      }),
      /disable signing and updates/u,
    );
  await writeFile(join(appOutDir, 'resources/legal/LICENSE'), 'Wrong notice');
  await assert.rejects(verifyUnsignedCommercialPackage(context), /legal notice/u);
});
