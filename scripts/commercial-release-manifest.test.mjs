import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import {
  verifyCommercialEnvelope,
  signCommercialManifest,
  stablePublicKeys,
  updatePayload,
  readCommercialCatalog,
  catalogBytes,
} from './commercial-release-manifest.mjs';
import {
  commercialReleaseFiles,
  publishCommercialRelease,
} from './commercial-release-publisher.mjs';
import {
  fixture,
  keySet,
  keyId,
  privateKeyPem,
  signed,
  memoryStore,
} from './commercial-release-test-support.mjs';

function manifest() {
  const f = fixture();
  const identity = verifyCommercialEnvelope(f.identity, keySet, 'release-identity');
  return updatePayload(identity, commercialReleaseFiles(f, identity));
}

test('postbuild envelope carries exact prebuild identity and is accepted by the actual desktop runtime verifier', async () => {
  const compile = async (name) =>
    ts.transpileModule(await readFile(new URL(`../electron/${name}.ts`, import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText;
  const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  const licenceUrl = moduleUrl(await compile('licensing-verification'));
  const runtime = await import(
    moduleUrl(
      (await compile('commercial-update')).replaceAll('./licensing-verification.js', licenceUrl),
    )
  );
  const licence = await import(licenceUrl);
  const f = fixture();
  const payload = manifest();
  const envelope = signCommercialManifest(payload, privateKeyPem, keyId, keySet);
  const keys = stablePublicKeys(keySet);
  assert.deepEqual(licence.verifyLicenceRelease(f.identity, keys), {
    version: '1.2.3',
    publishedAt: 1767225600,
  });
  const candidate = runtime.commercialUpdateCandidate(envelope, keys);
  assert.equal(candidate.version, '1.2.3');
  assert.equal(candidate.installer.sha256, payload.artifacts[0].sha256);
  assert.equal(
    runtime.updateInfoMatchesManifest(
      {
        version: '1.2.3',
        files: [
          {
            url: candidate.installer.name,
            size: candidate.installer.bytes,
            sha512: candidate.installer.sha512,
          },
        ],
        path: candidate.installer.name,
        sha512: candidate.installer.sha512,
      },
      candidate,
    ),
    true,
  );
  assert.deepEqual(verifyCommercialEnvelope(envelope, keySet), payload);
});

test('signed malformed/traversing/duplicate assets, dates and versions are rejected', () => {
  const cases = [
    (value) => {
      value.artifacts[0].name = '../evil.exe';
    },
    (value) => {
      value.artifacts[1] = value.artifacts[0];
    },
    (value) => {
      value.artifacts[0].sha512 = 'x'.repeat(88);
    },
    (value) => {
      value.artifacts[0].bytes = 300_000_001;
    },
    (value) => {
      value.artifacts[0].unexpected = true;
    },
    (value) => {
      value.publishedAt = '9999-01-01T00:00:00.000Z';
    },
    (value) => {
      value.version = '01.2.3';
    },
    (value) => {
      value.sourceRef = 'refs/heads/main';
    },
    (value) => {
      value.channel = 'preview';
    },
  ];
  for (const mutate of cases) {
    const value = manifest();
    mutate(value);
    assert.throws(() => verifyCommercialEnvelope(signed(value), keySet));
  }
});

test('signature tampering, wrong-purpose keys, unknown keys and noncanonical base64 fail before storage', async () => {
  const payload = manifest();
  const envelope = signed(payload);
  for (const changed of [
    { ...envelope, payload: `${envelope.payload}\n` },
    { ...envelope, signature: Buffer.alloc(64).toString('base64') },
    { ...envelope, keyId: 'unknown' },
    { ...envelope, algorithm: 'RSA' },
    { ...envelope, unexpected: 1 },
  ])
    assert.throws(() => verifyCommercialEnvelope(changed, keySet));
  assert.throws(() =>
    verifyCommercialEnvelope(envelope, {
      ...keySet,
      keys: keySet.keys.map((key) => ({ ...key, channel: 'preview' })),
    }),
  );
  const f = memoryStore();
  await assert.rejects(
    publishCommercialRelease({
      release: fixture(),
      store: f.store,
      keySet,
      privateKeyPem: '',
      keyId,
      verifyInstaller: async () => undefined,
      expectedCatalogSha256: 'none',
    }),
  );
  assert.equal(f.writes.length, 0);
});

test('catalogue refuses duplicates, unknown envelope keys and response bounds', () => {
  const payload = manifest();
  const envelope = signed(payload);
  assert.throws(
    () => readCommercialCatalog(catalogBytes([{ envelope }, { envelope }]), keySet),
    /duplicate/u,
  );
  assert.throws(() => readCommercialCatalog(Buffer.alloc(256 * 1024 + 1), keySet), /size/u);
  assert.throws(
    () =>
      readCommercialCatalog(
        Buffer.from(
          JSON.stringify({ schemaVersion: 1, releases: [{ ...envelope, keyId: 'unknown' }] }),
        ),
        keySet,
      ),
    /key/u,
  );
});
