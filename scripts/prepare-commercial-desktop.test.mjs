import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPackage } from '@electron/asar';
import ts from 'typescript';
import verifyCommercialPackage, {
  prepareCommercialMetadata,
  publicKeyRecord,
  runPreparation,
  verifyCommercialMetadata,
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
  assert.equal(config.nsis.license, paths.termsFile);
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
  await writeFile(join(app, 'package.json'), JSON.stringify(prepareCommercialMetadata(input)));
  await createPackage(app, join(appOutDir, 'resources/app.asar'));
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
});

// electron-builder logs "  • loaded configuration" to stdout, which node --test reads
// as its own message stream. Landing right after a test message, the bullet's bytes
// are misread as a negative message length, and the whole file fails with "Unable
// to deserialize cloned data" (seen in CI on 2026-09-29). Its log goes to stderr.
function builderLogToStderr(t, configModule) {
  const { log } = createRequire(configModule)('builder-util/out/log.js');
  const stream = log.stream;
  log.stream = process.stderr;
  t.after(() => {
    log.stream = stream;
  });
}

test('installed builder resolves commercial inheritance with mandatory signing and dedicated feed', async (t) => {
  const requireBuilder = createRequire(import.meta.resolve('electron-builder'));
  const configModule = requireBuilder.resolve('app-builder-lib/out/util/config/config.js');
  const { getConfig } = await import(pathToFileURL(configModule).href);
  builderLogToStderr(t, configModule);
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
  assert.equal(effective.nsis.license, paths.termsFile);
  assert.equal(effective.forceCodeSigning, true);
  assert.equal(effective.publish.url, 'https://dl.kerfdesk.com/desktop/commercial');
});
