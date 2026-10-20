import { manualDownloadKey, manualDownloadUrl } from '../public/desktop-manual-download.mjs';
import { MANUAL_CATALOG_KEY } from '../public/desktop-manual-catalog.mjs';
import { digest } from './commercial-release-manifest.mjs';
import { manualDownloadPayload, signManualDownload } from './manual-commercial-manifest.mjs';
import { releaseReceiptContext } from './desktop-release-receipt.mjs';
import * as support from './commercial-release-test-support.mjs';

export const file = (label) => ({
  bytes: Buffer.byteLength(label),
  sha256: digest(Buffer.from(label)),
  path: 'C:\\private\\secret.log',
});
export const blob = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
export const sourceSha = 'a'.repeat(40);
export const previousSha = 'b'.repeat(40);
export const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'cisgz3a-hub/KerfDesk',
  GITHUB_WORKFLOW_REF:
    'cisgz3a-hub/KerfDesk/.github/workflows/release-desktop-unsigned.yml@refs/heads/main',
  GITHUB_SHA: previousSha,
  RELEASE_SOURCE_SHA: sourceSha,
  GITHUB_RUN_ID: '12345',
  GITHUB_RUN_ATTEMPT: '2',
};

export async function fixture() {
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
