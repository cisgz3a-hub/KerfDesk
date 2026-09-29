import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPackage } from '@electron/asar';
import {
  requireCommercialUpdateConfig,
  verifyCommercialPackage,
  readCommercialPackage,
  createCommercialInstallerVerifier,
  verifyInstallerResources,
} from './commercial-release-package.mjs';
import {
  parsePublicationArguments,
  requireCommercialPublishContext,
  requireCommercialSource,
} from './publish-commercial-release.mjs';
import { digest } from './commercial-release-manifest.mjs';
import {
  fixture,
  keySet,
  entitlementKeySet,
  context,
  updateConfigText,
} from './commercial-release-test-support.mjs';

test('actual packaged ASAR is bound to signed prebuild identity and independent release/entitlement pins', async () => {
  const f = fixture();
  const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-commercial-package-test-'));
  try {
    await mkdir(join(directory, 'source'));
    await writeFile(join(directory, 'source', 'package.json'), JSON.stringify(f.metadata));
    await createPackage(join(directory, 'source'), join(directory, 'app.asar'));
    await writeFile(join(directory, 'app-update.yml'), updateConfigText);
    const result = await readCommercialPackage(
      directory,
      f.identity,
      keySet,
      'Example Publisher',
      entitlementKeySet,
    );
    assert.deepEqual(result.metadata, f.metadata);
    assert.equal(result.resourceDigests.length, 2);
    const other = fixture('1.2.4');
    await assert.rejects(
      readCommercialPackage(
        directory,
        other.identity,
        keySet,
        'Example Publisher',
        entitlementKeySet,
      ),
      /identity/u,
    );
    for (const field of ['releaseKeys', 'entitlementKeys']) {
      const bad = structuredClone(f.metadata);
      bad.kerfdeskCommercialLicense[field] = {};
      assert.throws(
        () => verifyCommercialPackage(bad, f.identity, keySet, entitlementKeySet),
        /keys/u,
      );
    }
    const untrusted = structuredClone(f.metadata);
    untrusted.kerfdeskUpdateChannelTrusted = false;
    assert.throws(
      () => verifyCommercialPackage(untrusted, f.identity, keySet, entitlementKeySet),
      /trust/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('commercial updater config fails closed for missing publisher, external feed, credentials or additional options', () => {
  assert.equal(
    requireCommercialUpdateConfig(updateConfigText, 'Example Publisher').provider,
    'generic',
  );
  for (const text of [
    updateConfigText.replace('publisherName: Example Publisher', ''),
    updateConfigText.replace('/commercial/', '/'),
    `${updateConfigText}token: secret\n`,
    `${updateConfigText}requestHeaders: { Authorization: token }\n`,
    `${updateConfigText}publisherName: Other\n`,
  ])
    assert.throws(() => requireCommercialUpdateConfig(text, 'Example Publisher'));
  for (const publisher of ['', undefined, ' Publisher ', 'a\nb'])
    assert.throws(() => requireCommercialUpdateConfig(updateConfigText, publisher));
});

const resourceBytes = [Buffer.from('asar exact bytes'), Buffer.from(updateConfigText)];
const resourceDigests = ['resources/app.asar', 'resources/app-update.yml'].map((name, index) => ({
  name,
  bytes: resourceBytes[index].length,
  sha256: digest(resourceBytes[index]),
}));
function signatureProbe(
  evidence = { status: 'Valid', type: 'Authenticode', subject: 'CN=Example Publisher, O=Example' },
) {
  const calls = [];
  const cleaned = [];
  return {
    calls,
    cleaned,
    options: {
      updateConfigText,
      expectedPublisher: 'Example Publisher',
      resourceDigests,
      archiveTool: async () => 'pinned-7za.exe',
      execute: async (command, args, options) => {
        calls.push({ command, args, options });
        return {
          stdout:
            command === 'pwsh'
              ? JSON.stringify(evidence)
              : resourceBytes[resourceDigests.findIndex((item) => item.name === args.at(-1))],
        };
      },
      io: {
        mkdtemp: async (prefix) => `${prefix}test`,
        writeFile: async () => undefined,
        rm: async (directory) => cleaned.push(directory),
      },
    },
  };
}

test('native verification requires valid Authenticode, the expected publisher and byte-identical embedded resources', async () => {
  const f = signatureProbe();
  await createCommercialInstallerVerifier(f.options)(Buffer.from('exe'));
  assert.equal(f.calls[0].command, 'pwsh');
  assert.ok(f.calls[0].args.at(-1).includes('Get-AuthenticodeSignature'));
  assert.equal(f.calls[0].options.windowsHide, true);
  assert.equal(f.calls[1].options.encoding, 'buffer');
  assert.equal(f.calls[1].options.maxBuffer, resourceBytes[0].length + 1);
  assert.deepEqual(
    f.calls.slice(1).map((call) => call.args.at(-1)),
    resourceDigests.map((item) => item.name),
  );
  assert.equal(f.cleaned.length, 1);
  for (const evidence of [
    { status: 'UnknownError', type: 'Authenticode', subject: 'CN=Example Publisher' },
    { status: 'Valid', type: 'Catalog', subject: 'CN=Example Publisher' },
    { status: 'Valid', type: 'Authenticode', subject: 'CN=Other' },
  ]) {
    const bad = signatureProbe(evidence);
    await assert.rejects(createCommercialInstallerVerifier(bad.options)(Buffer.from('exe')));
    assert.equal(bad.cleaned.length, 1);
    assert.equal(bad.calls.length, 1);
  }
});

test('absent, mismatched, duplicate, oversized, or failed archive output cannot pass package pairing', async () => {
  for (const output of [
    Buffer.alloc(0),
    Buffer.from('wrong asar bytes'),
    Buffer.concat([resourceBytes[0], resourceBytes[0]]),
    'text',
  ]) {
    await assert.rejects(
      verifyInstallerResources('installer.exe', resourceDigests, {
        archiveTool: async () => '7za',
        execute: async () => ({ stdout: output }),
      }),
      /resources/u,
    );
  }
  await assert.rejects(verifyInstallerResources('installer.exe', undefined), /mandatory/u);
  await assert.rejects(
    verifyInstallerResources('installer.exe', resourceDigests, {
      archiveTool: async () => '7za',
      execute: async () => {
        throw new Error('maxBuffer exceeded');
      },
    }),
    /maxBuffer/u,
  );
  const failed = signatureProbe();
  failed.options.execute = async () => {
    throw new Error('spawn failed');
  };
  await assert.rejects(
    createCommercialInstallerVerifier(failed.options)(Buffer.from('exe')),
    /spawn/u,
  );
  assert.equal(failed.cleaned.length, 1);
  const cleanup = signatureProbe();
  cleanup.options.io.rm = async () => {
    throw new Error('cleanup failed');
  };
  await assert.rejects(
    createCommercialInstallerVerifier(cleanup.options)(Buffer.from('exe')),
    /cleanup/u,
  );
});

test('the operator states the expected catalogue explicitly: its SHA-256 or none', () => {
  const paths = ['release', 'identity.json', 'resources'];
  const hash = 'ab'.repeat(32);
  assert.deepEqual(parsePublicationArguments(['--expected-catalog-sha256', 'none', ...paths]), {
    releaseDirectory: 'release',
    identityPath: 'identity.json',
    resourcesDirectory: 'resources',
    expectedCatalogSha256: 'none',
  });
  assert.equal(
    parsePublicationArguments([...paths, '--expected-catalog-sha256', hash.toUpperCase()])
      .expectedCatalogSha256,
    hash,
  );
  for (const args of [
    paths,
    ['--expected-catalog-sha256', ...paths],
    ['--expected-catalog-sha256', 'latest', ...paths],
    ['--expected-catalog-sha256', hash.slice(1), ...paths],
    ['--expected-catalog-sha256', 'none', ...paths.slice(1)],
    ['--expected-catalog-sha256', 'none', ...paths, 'extra'],
    ['--expected-catalog-sha256', 'none', '--expected-catalog-sha256', 'none', ...paths],
  ])
    assert.throws(() => parsePublicationArguments(args), /Usage/u);
});

test('local operator publication requires explicit Windows signing/account inputs and the exact clean source checkout', async () => {
  const f = fixture();
  const identity = JSON.parse(Buffer.from(f.identity.payload, 'base64').toString());
  const env = Object.fromEntries(
    Object.entries(context(f.identity)).filter(
      ([name]) =>
        !name.startsWith('GITHUB_') &&
        name !== 'APPROVED_RELEASE_SHA' &&
        name !== 'COMMERCIAL_PUBLICATION_GROUP',
    ),
  );
  assert.doesNotThrow(() => requireCommercialPublishContext(env, identity, 'win32'));
  for (const name of Object.keys(env))
    assert.throws(() => requireCommercialPublishContext({ ...env, [name]: '' }, identity, 'win32'));
  assert.throws(() => requireCommercialPublishContext(env, identity, 'linux'), /Windows/u);
  const exec = (head, status) => async (_command, args) => ({
    stdout: args[0] === 'rev-parse' ? head : status,
  });
  await requireCommercialSource(identity, 'repo', exec(`${identity.sourceSha}\n`, ''));
  await assert.rejects(
    requireCommercialSource(identity, 'repo', exec('b'.repeat(40), '')),
    /source SHA/u,
  );
  await assert.rejects(
    requireCommercialSource(identity, 'repo', exec(identity.sourceSha, ' M electron/main.ts')),
    /clean/u,
  );
});
