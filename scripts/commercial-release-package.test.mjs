import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPackage } from '@electron/asar';
import {
  commercialToolEnvironment,
  requireCommercialUpdateConfig,
  verifyCommercialPackage,
  readCommercialPackage,
  createCommercialInstallerVerifier,
  verifyInstallerResources,
} from './commercial-release-package.mjs';
import {
  parsePublicationArguments,
  publicationFailureMessage,
  requireCommercialPublishContext,
  requireCommercialSource,
} from './publish-commercial-release.mjs';
import { publishCommercialRelease } from './commercial-release-publisher.mjs';
import { CommercialReleaseError, digest } from './commercial-release-manifest.mjs';
import {
  fixture,
  keySet,
  keyId,
  entitlementKeySet,
  context,
  memoryStore,
  privateKeyPem,
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
  const lookups = [];
  const exec =
    (head, status, tag = head) =>
    async (_command, args) => {
      if (args[0] === 'status') return { stdout: status };
      if (args.at(-1) === 'HEAD') return { stdout: head };
      lookups.push(args);
      if (tag instanceof Error) throw tag;
      return { stdout: tag };
    };
  const exit = (code) => Object.assign(new Error(`git exited ${code}`), { code });
  await requireCommercialSource(identity, 'repo', exec(`${identity.sourceSha}\n`, ''));
  assert.deepEqual(lookups, [['rev-parse', '--verify', '--quiet', 'refs/tags/v1.2.3^{commit}']]);
  for (const tag of ['b'.repeat(40), exit(1)])
    await assert.rejects(
      requireCommercialSource(identity, 'repo', exec(identity.sourceSha, '', tag)),
      /Release tag v1\.2\.3 must exist in this checkout and point at the signed source SHA/u,
    );
  await assert.rejects(
    requireCommercialSource(identity, 'repo', exec(identity.sourceSha, '', exit(128))),
    /git exited 128/u,
  );
  await assert.rejects(
    requireCommercialSource(identity, 'repo', exec('b'.repeat(40), '')),
    /source SHA/u,
  );
  await assert.rejects(
    requireCommercialSource(identity, 'repo', exec(identity.sourceSha, ' M electron/main.ts')),
    /clean/u,
  );
});

const SECRETS = {
  DESKTOP_STABLE_MANIFEST_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIHN5bnRoZXRpYy1rZXktZm9yLWVudi10ZXN0cy1vbmx5\n-----END PRIVATE KEY-----\n',
  COMMERCIAL_R2_API_TOKEN: 'synthetic-r2-token-for-environment-tests',
  COMMERCIAL_CLOUDFLARE_ACCOUNT_ID: 'f'.repeat(32),
};
const TOOL_NAMES = ['SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'COMSPEC'];
const GENERIC_FAILURE =
  'Commercial publication failed. Check the signed identity, native signer, clean source checkout, immutable artifacts and protected R2 configuration.';
async function withEnvironment(values, run) {
  const original = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, values);
    return await run();
  } finally {
    for (const [name, value] of Object.entries(original))
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
  }
}

test('pwsh, 7za and git receive a minimal environment without the signing key or R2 token', async () => {
  const windows = {
    Path: 'C:\\Tools',
    SystemRoot: 'C:\\Windows',
    windir: 'C:\\Windows',
    PATHEXT: '.COM;.EXE',
    TEMP: 'C:\\Temp',
    TMP: 'C:\\Temp',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
  };
  assert.deepEqual(
    commercialToolEnvironment(
      { KERFDESK_RELEASE_VERIFY_PATH: 'installer.exe' },
      { ...windows, ...SECRETS, USERPROFILE: 'C:\\Users\\operator', NODE_OPTIONS: '--inspect' },
    ),
    { ...windows, KERFDESK_RELEASE_VERIFY_PATH: 'installer.exe' },
  );
  const identity = JSON.parse(Buffer.from(fixture().identity.payload, 'base64').toString());
  const environments = await withEnvironment(SECRETS, async () => {
    const probe = signatureProbe();
    await createCommercialInstallerVerifier(probe.options)(Buffer.from('exe'));
    const git = [];
    await requireCommercialSource(identity, 'repo', async (_command, args, options) => {
      git.push(options.env);
      return { stdout: args[0] === 'status' ? '' : identity.sourceSha };
    });
    assert.equal(
      probe.calls[0].options.env.KERFDESK_RELEASE_VERIFY_PATH,
      join(`${join(tmpdir(), 'kerfdesk-commercial-signature-')}test`, 'installer.exe'),
    );
    return [...probe.calls.map((call) => call.options.env), ...git];
  });
  assert.equal(environments.length, 6);
  for (const env of environments) {
    assert.notEqual(env, process.env);
    for (const name of Object.keys(env))
      assert.ok(TOOL_NAMES.includes(name.toUpperCase()) || name === 'KERFDESK_RELEASE_VERIFY_PATH');
    for (const secret of Object.values(SECRETS))
      assert.equal(
        Object.values(env).some((value) => value.includes(secret)),
        false,
      );
  }
});

test('failure output shows only own refusals, never an environment value, key or URL', async () => {
  const env = { ...SECRETS, DESKTOP_WINDOWS_PUBLISHER_NAME: 'Example Publisher', CI: 'true' };
  const refusal = await publishCommercialRelease({
    release: fixture(),
    store: memoryStore().store,
    keySet,
    privateKeyPem,
    keyId,
    verifyInstaller: async () => undefined,
    expectedCatalogSha256: 'a'.repeat(64),
  }).catch((error) => error);
  assert.equal(
    publicationFailureMessage(refusal, env),
    'Commercial publication failed: Live commercial catalogue (missing) is not the expected catalogue; review it before publishing.',
  );
  const verifier = (() => {
    try {
      requireCommercialUpdateConfig(updateConfigText, '');
    } catch (error) {
      return error;
    }
  })();
  assert.equal(
    publicationFailureMessage(verifier, env),
    'Commercial publication failed: Explicit Windows signing publisher is required.',
  );
  // Short values such as CI=true are not secrets and do not hide a refusal.
  assert.equal(
    publicationFailureMessage(new CommercialReleaseError('Channel trust must be true.'), env),
    'Commercial publication failed: Channel trust must be true.',
  );
  for (const error of [
    new Error(`R2 request failed: https://api.cloudflare.com/client/v4/accounts/${'f'.repeat(32)}`),
    Object.assign(new Error('Command failed: pwsh -NoProfile'), { code: 1 }),
    new SyntaxError('Unexpected token < in JSON at position 0'),
    'a thrown string',
    new CommercialReleaseError(`R2 token ${SECRETS.COMMERCIAL_R2_API_TOKEN} was refused`),
    new CommercialReleaseError(`key ${SECRETS.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY.split('\n')[1]}`),
    new CommercialReleaseError(`account ${SECRETS.COMMERCIAL_CLOUDFLARE_ACCOUNT_ID}`),
    new CommercialReleaseError('publisherName (Example Publisher) does not match'),
    new CommercialReleaseError('fetch https://operator:hunter2@r2.example.invalid/bucket'),
    new CommercialReleaseError('-----BEGIN PRIVATE KEY-----'),
    new CommercialReleaseError('first line\nsecond line'),
  ])
    assert.equal(publicationFailureMessage(error, env), GENERIC_FAILURE);
  assert.equal(
    publicationFailureMessage(new CommercialReleaseError('code k7'), { SIGNING_KEY: 'k7' }),
    GENERIC_FAILURE,
  );
});

test('the publication CLI prints its own refusal, and a generic line for anything else', async () => {
  const script = fileURLToPath(new URL('./publish-commercial-release.mjs', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-commercial-cli-test-'));
  try {
    // Signed by a test key that the repository's stable trust anchors do not pin.
    const identityPath = join(directory, 'identity.json');
    await writeFile(identityPath, JSON.stringify(fixture().identity));
    const expected = ['--expected-catalog-sha256', 'none'];
    for (const [args, line] of [
      [
        [],
        'Commercial publication failed: Usage: publish-commercial-release.mjs --expected-catalog-sha256 <64-hex|none> <release-directory> <commercial-release-identity.json> <packaged-resources-directory>',
      ],
      [
        [...expected, directory, identityPath, directory],
        'Commercial publication failed: Invalid commercial release: untrusted signing key',
      ],
      [[...expected, directory, join(directory, 'absent.json'), directory], GENERIC_FAILURE],
    ]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        env: { ...commercialToolEnvironment(), ...SECRETS },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.trim(), line);
      for (const secret of [...Object.values(SECRETS), directory])
        assert.equal(result.stderr.includes(secret), false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
