import assert from 'node:assert/strict';
import test from 'node:test';
import { manualDownloadKey, manualDownloadUrl } from '../public/desktop-manual-download.mjs';
import { MANUAL_CATALOG_KEY } from '../public/desktop-manual-catalog.mjs';
import { verifySignedEnvelope } from '../public/desktop-release-manifest.mjs';
import { digest } from './commercial-release-manifest.mjs';
import { manualDownloadPayload, signManualDownload } from './manual-commercial-manifest.mjs';
import { releaseReceiptContext, retainReleaseReceipt } from './desktop-release-receipt.mjs';
import { parseReceiptArguments } from './publish-desktop-release-receipt.mjs';
import * as support from './commercial-release-test-support.mjs';

const file = (label) => ({
  bytes: Buffer.byteLength(label),
  sha256: digest(Buffer.from(label)),
  path: 'C:\\private\\secret.log',
});
const blob = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const sourceSha = 'a'.repeat(40);
const previousSha = 'b'.repeat(40);
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'cisgz3a-hub/KerfDesk',
  GITHUB_WORKFLOW_REF:
    'cisgz3a-hub/KerfDesk/.github/workflows/release-desktop-unsigned.yml@refs/heads/main',
  GITHUB_SHA: previousSha,
  RELEASE_SOURCE_SHA: sourceSha,
  GITHUB_RUN_ID: '12345',
  GITHUB_RUN_ATTEMPT: '2',
};

async function fixture() {
  const identity = support.fixture('1.2.3', { sourceRef: 'refs/heads/main' }).identity;
  const release = JSON.parse(Buffer.from(identity.payload, 'base64'));
  const previousIdentity = support.signed({ ...release, version: '1.2.2', sourceSha: previousSha });
  const manifestValue = manualDownloadPayload(
    identity,
    Buffer.from('candidate installer'),
    support.keySet,
  );
  const previousValue = manualDownloadPayload(
    previousIdentity,
    Buffer.from('previous installer'),
    support.keySet,
  );
  const manifestEnvelope = await signManualDownload(
    manifestValue,
    support.privateKeyPem,
    support.keyId,
    support.keySet,
  );
  const previousEnvelope = await signManualDownload(
    previousValue,
    support.privateKeyPem,
    support.keyId,
    support.keySet,
  );
  const manifest = blob(manifestEnvelope);
  const previousManifest = blob(previousEnvelope);
  const installer = manifestValue.artifacts[0];
  const context = releaseReceiptContext(env, sourceSha);
  const installed = (name, version = '1.2.3') => ({
    name,
    exitCode: 0,
    installed: {
      commercialUnsignedMetadataVerified: true,
      trustedUpdater: false,
      asar: file('archive'),
      candidateAsar: file('archive'),
      executable: file('executable'),
      candidateExecutable: file('executable'),
      registry: [{ displayVersion: version }],
    },
  });
  const launch = {
    schemaVersion: 1,
    status: 'passed',
    scenario: 'Launch',
    packageKind: 'CommercialUnsigned',
    sourceCommit: sourceSha,
    qualificationSourceCommit: sourceSha,
    runId: '12345',
    runAttempt: '2',
    versions: ['1.2.3'],
    candidates: [{ signature: 'NotSigned', file: installer }],
    steps: [
      installed('fresh-install'),
      { name: 'installed-launch', evidence: 'private-path' },
      { name: 'final-uninstall', exitCode: 0 },
    ],
    rawLog: 'Bearer secret-token',
  };
  const upgrade = {
    ...launch,
    scenario: 'HistoricalUpgrade',
    sourceCommit: previousSha,
    upgradeSourceCommit: sourceSha,
    versions: ['1.2.2', '1.2.3'],
    candidates: [
      { signature: 'NotSigned', file: previousValue.artifacts[0] },
      launch.candidates[0],
    ],
    retainedProject: file('project'),
    retainedProfileSentinel: file('sentinel'),
    steps: [
      installed('historical-baseline-install', '1.2.2'),
      installed('historical-upgrade-install'),
      installed('historical-same-version-reinstall'),
      installed('historical-install-after-uninstall'),
      ...[
        'native-historical-create',
        'historical-restart-reopen',
        'historical-upgrade-reopen',
        'historical-reinstall-reopen',
        'historical-restore-reopen',
      ].map((name) => ({ name, project: file('project') })),
      ...['historical-uninstall-retaining-data', 'historical-final-uninstall'].map((name) => ({
        name,
        exitCode: 0,
      })),
    ],
  };
  const restoration = {
    exitCode: 0,
    beforeSha256: file('archive').sha256.toUpperCase(),
    afterSha256: file('archive').sha256.toUpperCase(),
  };
  const lockfileSha256 = digest(Buffer.from('lockfile'));
  const dependencyAudit = {
    evidenceStatus: 'valid',
    sourceSha,
    runId: '12345',
    runAttempt: '2',
    lockfileSha256,
    runtimeCount: 0,
    releaseBuildOnlyCount: 1,
    buildTestOnlyCount: 0,
    advisories: [
      { reachability: 'release-build-only', title: 'secret title', paths: ['private/path'] },
    ],
  };
  const delivery = {
    schemaVersion: 1,
    kind: 'desktop-public-delivery-verification',
    status: 'verified',
    version: '1.2.3',
    sourceSha,
    codeSigning: 'unsigned',
    updates: 'manual',
    installerExecuted: false,
    manifestSha256: digest(manifest),
    artifact: { ...installer, url: manualDownloadUrl('1.2.3', installer.name) },
    objects: {
      immutable: {
        sha256: digest(manifest),
        bytes: manifest.length,
        url: manualDownloadUrl('1.2.3', 'download-manifest.json'),
      },
    },
    checks: Object.fromEntries(
      [
        'latestSignature',
        'immutableManifest',
        'catalogue',
        'releaseNotes',
        'installerBytes',
        'latestUnchanged',
      ].map((name) => [name, true]),
    ),
    website: {
      status: 'verified',
      version: '1.2.3',
      sha256: installer.sha256,
      installerUrl: manualDownloadUrl('1.2.3', installer.name),
      manifestUrl: manualDownloadUrl('1.2.3', 'download-manifest.json'),
    },
    token: 'secret-token',
  };
  const memory = support.memoryStore();
  memory.objects.set(manualDownloadKey('1.2.3', 'download-manifest.json'), manifest);
  memory.objects.set(
    MANUAL_CATALOG_KEY,
    blob({
      schemaVersion: 1,
      kind: 'manual-download-catalog',
      releases: [previousEnvelope, manifestEnvelope],
    }),
  );
  return {
    ...memory,
    ...support,
    identity,
    installer,
    manifest,
    previousManifest,
    manifestEnvelope,
    context,
    launch,
    upgrade,
    restoration,
    dependencyAudit,
    lockfileSha256,
    delivery,
  };
}

test('retains compact independently verifiable success evidence and exact retries write nothing', async () => {
  const f = await fixture();
  const result = await retainReleaseReceipt(f);
  assert.equal(result.status, 'retained');
  assert.match(result.key, /1\.2\.3\/release-receipts\/12345-2\.json$/u);
  assert.equal(f.writes.length, 1);
  const bytes = f.objects.get(result.key);
  assert.ok(bytes.length < 32_768);
  const payload = await verifySignedEnvelope(JSON.parse(bytes), support.keySet, 'stable');
  assert.equal(payload.manifestSha256, digest(f.manifest));
  assert.deepEqual(payload.installer, f.installer);
  assert.equal(payload.qualification.upgrade.status, 'passed');
  assert.equal(payload.qualification.asar.restored, true);
  assert.doesNotMatch(JSON.stringify(payload), /private|secret-token|secret title|Bearer|C:\\/u);
  assert.equal((await retainReleaseReceipt(f)).status, 'already-retained');
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].metadata.cacheControl, 'public, max-age=31536000, immutable');
});

const mutations = [
  [
    'missing website proof',
    (f) => {
      f.delivery.website = null;
    },
  ],
  [
    'wrong website release',
    (f) => {
      f.delivery.website.version = '1.2.2';
    },
  ],
  [
    'wrong website installer',
    (f) => {
      f.delivery.website.installerUrl = 'https://example.com/setup.exe';
    },
  ],
  [
    'changed saved project',
    (f) => {
      f.upgrade.steps.find((step) => step.name === 'historical-upgrade-reopen').project =
        file('changed');
    },
  ],
  [
    'wrong candidate installer',
    (f) => {
      f.installer = { ...f.installer, sha256: '0'.repeat(64) };
    },
  ],
  [
    'wrong workflow',
    (f) => {
      f.context.workflow = 'another-workflow';
    },
  ],
  [
    'wrong source',
    (f) => {
      f.context.sourceSha = previousSha;
    },
  ],
  [
    'failed launch',
    (f) => {
      f.launch.status = 'failed';
    },
  ],
  [
    'other run evidence',
    (f) => {
      f.launch.runId = '999';
    },
  ],
  [
    'other attempt',
    (f) => {
      f.launch.runAttempt = '1';
    },
  ],
  [
    'wrong launch installer',
    (f) => {
      f.launch.candidates[0].file = file('wrong');
    },
  ],
  [
    'missing launch',
    (f) => {
      f.launch.steps.splice(1, 1);
    },
  ],
  [
    'duplicate launch',
    (f) => {
      f.launch.steps.push(f.launch.steps[0]);
    },
  ],
  [
    'different installed archive',
    (f) => {
      f.launch.steps[0].installed.asar = file('other');
    },
  ],
  [
    'wrong upgrade source',
    (f) => {
      f.upgrade.upgradeSourceCommit = previousSha;
    },
  ],
  [
    'incomplete upgrade',
    (f) => {
      f.upgrade.steps.pop();
    },
  ],
  [
    'missing retained profile',
    (f) => {
      delete f.upgrade.retainedProfileSentinel;
    },
  ],
  [
    'changed archive after probe',
    (f) => {
      f.restoration.afterSha256 = '0'.repeat(64);
    },
  ],
  [
    'probe failure',
    (f) => {
      f.restoration.exitCode = 1;
    },
  ],
  [
    'runtime advisory',
    (f) => {
      f.dependencyAudit.runtimeCount = 1;
    },
  ],
  [
    'wrong dependency lockfile',
    (f) => {
      f.dependencyAudit.lockfileSha256 = '0'.repeat(64);
    },
  ],
  [
    'wrong dependency source',
    (f) => {
      f.dependencyAudit.sourceSha = previousSha;
    },
  ],
  [
    'invalid advisory counts',
    (f) => {
      f.dependencyAudit.releaseBuildOnlyCount = 0;
    },
  ],
  [
    'public installer unverified',
    (f) => {
      f.delivery.checks.installerBytes = false;
    },
  ],
  [
    'wrong public manifest',
    (f) => {
      f.delivery.manifestSha256 = '0'.repeat(64);
    },
  ],
  [
    'wrong public source',
    (f) => {
      f.delivery.sourceSha = previousSha;
    },
  ],
  [
    'executed installer',
    (f) => {
      f.delivery.installerExecuted = true;
    },
  ],
  [
    'bad prior signature',
    (f) => {
      const envelope = JSON.parse(f.previousManifest);
      envelope.signature = 'A'.repeat(86) + '==';
      f.previousManifest = blob(envelope);
    },
  ],
];
for (const [name, mutate] of mutations)
  test(`refuses ${name} before any storage write`, async () => {
    const f = await fixture();
    mutate(f);
    await assert.rejects(retainReleaseReceipt(f));
    assert.equal(f.writes.length, 0);
  });

test('does not replace a conflicting existing success receipt', async () => {
  const f = await fixture();
  const result = await retainReleaseReceipt(f);
  f.delivery.website.screenshot = 'new-screenshot.png';
  await assert.rejects(retainReleaseReceipt(f), /conflicts/u);
  assert.equal(f.writes.length, 1);
  assert.equal(digest(f.objects.get(result.key)), result.sha256);
});

test('refuses a changed immutable manifest or failed receipt readback', async () => {
  const f = await fixture();
  f.objects.set(manualDownloadKey('1.2.3', 'download-manifest.json'), Buffer.from('changed'));
  await assert.rejects(retainReleaseReceipt(f), /manifest readback/u);
  assert.equal(f.writes.length, 0);
  f.objects.set(manualDownloadKey('1.2.3', 'download-manifest.json'), f.manifest);
  f.store.put = async () => undefined;
  await assert.rejects(retainReleaseReceipt(f), /receipt readback/u);
});

test('first-release exception requires an authenticated catalogue containing only this release', async () => {
  const f = await fixture();
  f.firstRelease = true;
  delete f.upgrade;
  delete f.previousManifest;
  await assert.rejects(retainReleaseReceipt(f), /first release/u);
  assert.equal(f.writes.length, 0);
  f.objects.set(
    MANUAL_CATALOG_KEY,
    blob({ schemaVersion: 1, kind: 'manual-download-catalog', releases: [f.manifestEnvelope] }),
  );
  const result = await retainReleaseReceipt(f);
  const payload = await verifySignedEnvelope(
    JSON.parse(f.objects.get(result.key)),
    support.keySet,
    'stable',
  );
  assert.equal(payload.qualification.upgrade.status, 'not-applicable-first-release');
});

test('CLI rejects missing, duplicate, unknown and contradictory evidence options', () => {
  const args = [
    '--identity',
    'identity',
    '--installer',
    'app.exe',
    '--launch',
    'launch',
    '--asar-restoration',
    'restored',
    '--dependency-audit',
    'audit',
    '--public-delivery',
    'delivery',
  ];
  assert.equal(parseReceiptArguments([...args, '--first-release']).firstRelease, true);
  assert.equal(
    parseReceiptArguments([...args, '--upgrade', 'upgrade', '--previous-manifest', 'old'])
      .firstRelease,
    false,
  );
  for (const invalid of [
    args,
    [...args, '--first-release', '--first-release'],
    [...args, '--first-release', '--upgrade', 'upgrade'],
    [...args, '--first-release', '--identity', 'again'],
    [...args, '--other', 'value'],
  ])
    assert.throws(() => parseReceiptArguments(invalid));
  assert.throws(() =>
    releaseReceiptContext({ ...env, RELEASE_SOURCE_SHA: previousSha }, sourceSha),
  );
});
