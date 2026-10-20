import { createPrivateKey, sign } from 'node:crypto';
import { verifySignedEnvelope } from '../public/desktop-release-manifest.mjs';
import {
  manualDownloadKey,
  manualDownloadUrl,
  verifyManualDownload,
} from '../public/desktop-manual-download.mjs';
import { MANUAL_CATALOG_KEY, verifyManualCatalog } from '../public/desktop-manual-catalog.mjs';
import { compareCommercialVersions } from '../public/desktop-commercial-catalog.mjs';
import {
  CommercialReleaseError,
  digest,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';

const LIMIT = 32_768;
const HASH = /^[a-f0-9]{64}$/u;
const REPOSITORY = 'cisgz3a-hub/KerfDesk';
const WORKFLOW = `${REPOSITORY}/.github/workflows/release-desktop-unsigned.yml@refs/heads/main`;
const requireValue = (condition, message) => {
  if (!condition) throw new CommercialReleaseError(`Release receipt refused: ${message}.`);
};
const same = (a, b) => Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b);
const hash = (value) => typeof value === 'string' && HASH.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const sameArtifact = (a, b) => a?.sha256 === b?.sha256 && a?.bytes === b?.bytes;
const summaryHash = (value) => digest(Buffer.from(JSON.stringify(value)));

function validateReceiptContext(context, sourceSha) {
  requireValue(
    context?.repository === REPOSITORY &&
      context.workflow === WORKFLOW &&
      context.sourceSha === sourceSha &&
      /^[a-f0-9]{40}$/u.test(sourceSha) &&
      /^[1-9]\d{0,19}$/u.test(context.runId ?? '') &&
      /^[1-9]\d{0,5}$/u.test(context.runAttempt ?? ''),
    'the exact candidate and canonical original release context are required',
  );
  return context;
}

export function releaseReceiptContext(env, sourceSha) {
  requireValue(env.GITHUB_ACTIONS === 'true', 'GitHub Actions release context required');
  return validateReceiptContext(
    {
      repository: env.GITHUB_REPOSITORY,
      workflow: env.GITHUB_WORKFLOW_REF,
      sourceSha: env.RELEASE_SOURCE_SHA,
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT,
    },
    sourceSha,
  );
}

function qualification(receipt, context, scenario, versions, sources, artifacts) {
  requireValue(
    receipt?.schemaVersion === 1 &&
      receipt.status === 'passed' &&
      receipt.packageKind === 'CommercialUnsigned' &&
      receipt.scenario === scenario &&
      receipt.runId === context.runId &&
      receipt.runAttempt === context.runAttempt &&
      receipt.qualificationSourceCommit === context.sourceSha &&
      receipt.sourceCommit === sources[0] &&
      (scenario !== 'HistoricalUpgrade' || receipt.upgradeSourceCommit === sources[1]) &&
      JSON.stringify(receipt.versions) === JSON.stringify(versions) &&
      Array.isArray(receipt.candidates) &&
      receipt.candidates.length === artifacts.length &&
      receipt.candidates.every(
        (item, index) =>
          item.signature === 'NotSigned' && sameArtifact(item.file, artifacts[index]),
      ) &&
      Array.isArray(receipt.steps),
    'native qualification does not prove the candidate in this run',
  );
  const names = receipt.steps.map((step) => step.name);
  requireValue(new Set(names).size === names.length, 'ambiguous qualification steps');
  return (name) => {
    const step = receipt.steps.find((entry) => entry.name === name);
    requireValue(step !== undefined, 'incomplete qualification steps');
    return step;
  };
}

function installed(step, artifactVersion) {
  const state = step.installed;
  requireValue(
    step.exitCode === 0 &&
      state?.commercialUnsignedMetadataVerified === true &&
      state.trustedUpdater === false &&
      sameArtifact(state.asar, state.candidateAsar) &&
      sameArtifact(state.executable, state.candidateExecutable) &&
      hash(state.asar?.sha256) &&
      positive(state.asar?.bytes) &&
      hash(state.executable?.sha256) &&
      positive(state.executable?.bytes) &&
      Array.isArray(state.registry) &&
      state.registry.length === 1 &&
      state.registry[0].displayVersion === artifactVersion,
    'installed candidate identity or archive is unverified',
  );
  return state.asar.sha256;
}

function dependencySummary(report, context, lockfileSha256) {
  requireValue(
    report?.evidenceStatus === 'valid' &&
      report.sourceSha === context.sourceSha &&
      report.runId === context.runId &&
      report.runAttempt === context.runAttempt &&
      hash(lockfileSha256) &&
      report.lockfileSha256 === lockfileSha256 &&
      report.runtimeCount === 0 &&
      Array.isArray(report.advisories) &&
      report.advisories.length <= 4096,
    'dependency evidence is missing, unbound or reports runtime advisories',
  );
  const groups = ['runtime-reachable', 'release-build-only', 'build-test-only'];
  requireValue(
    report.advisories.every((entry) => groups.includes(entry.reachability)),
    'invalid dependency classification',
  );
  const counts = groups.map(
    (group) => report.advisories.filter((entry) => entry.reachability === group).length,
  );
  requireValue(
    JSON.stringify(counts) ===
      JSON.stringify([
        report.runtimeCount,
        report.releaseBuildOnlyCount,
        report.buildTestOnlyCount,
      ]),
    'dependency counts disagree with evidence',
  );
  return {
    status: 'passed',
    lockfileSha256,
    runtimeCount: counts[0],
    releaseBuildOnlyCount: counts[1],
    buildTestOnlyCount: counts[2],
  };
}

function deliverySummary(delivery, release, manifest) {
  const checks = [
    'latestSignature',
    'immutableManifest',
    'catalogue',
    'releaseNotes',
    'installerBytes',
    'latestUnchanged',
  ];
  requireValue(
    delivery?.schemaVersion === 1 &&
      delivery.kind === 'desktop-public-delivery-verification' &&
      delivery.status === 'verified' &&
      delivery.version === release.version &&
      delivery.sourceSha === release.sourceSha &&
      delivery.codeSigning === 'unsigned' &&
      delivery.updates === 'manual' &&
      delivery.installerExecuted === false &&
      delivery.manifestSha256 === digest(manifest) &&
      delivery.objects?.immutable?.sha256 === digest(manifest) &&
      delivery.objects.immutable.bytes === manifest.length &&
      delivery.objects.immutable.url ===
        manualDownloadUrl(release.version, 'download-manifest.json') &&
      delivery.artifact?.name === release.artifacts[0].name &&
      delivery.artifact.url === manualDownloadUrl(release.version, release.artifacts[0].name) &&
      sameArtifact(delivery.artifact, release.artifacts[0]) &&
      checks.every((key) => delivery.checks?.[key] === true),
    'public delivery verification does not match the published candidate',
  );
  requireValue(
    delivery.website?.status === 'verified' &&
      delivery.website.version === release.version &&
      delivery.website.sha256 === release.artifacts[0].sha256 &&
      delivery.website.installerUrl === delivery.artifact.url &&
      delivery.website.manifestUrl === delivery.objects.immutable.url,
    'website verification is incomplete or names another release',
  );
  return {
    status: 'verified',
    checks: Object.fromEntries(checks.map((key) => [key, true])),
    website: 'verified',
    installerExecuted: false,
  };
}

/** Only an explicit allowlist is public; local receipts can contain paths and logs. */
export async function createReleaseReceiptPayload(input) {
  const {
    identity,
    installer,
    manifest,
    keySet,
    context,
    launch,
    upgrade,
    previousManifest,
    firstRelease = false,
    restoration,
    dependencyAudit,
    lockfileSha256,
    delivery,
  } = input;
  const signedIdentity = verifyCommercialEnvelope(identity, keySet, 'release-identity');
  validateReceiptContext(context, signedIdentity.sourceSha);
  requireValue(
    Buffer.isBuffer(manifest) && manifest.length <= 65_536,
    'bounded signed manifest required',
  );
  const release = await verifyManualDownload(manifest.toString('utf8'), keySet);
  requireValue(
    release.codeSigning === 'unsigned' &&
      Object.entries(signedIdentity).every(
        ([key, value]) => key === 'kind' || release[key] === value,
      ),
    'release identity differs from immutable manifest',
  );
  requireValue(
    context.sourceSha === release.sourceSha &&
      installer?.name === release.artifacts[0].name &&
      sameArtifact(installer, release.artifacts[0]),
    'installer differs from immutable manifest',
  );
  const launchStep = qualification(
    launch,
    context,
    'Launch',
    [release.version],
    [release.sourceSha],
    [installer],
  );
  const asarSha256 = installed(launchStep('fresh-install'), release.version);
  launchStep('installed-launch');
  requireValue(launchStep('final-uninstall').exitCode === 0, 'fresh-install cleanup did not pass');
  let upgradeSummary;
  if (firstRelease) {
    requireValue(
      previousManifest === undefined && upgrade === undefined,
      'first-release evidence is contradictory',
    );
    upgradeSummary = { status: 'not-applicable-first-release' };
  } else {
    requireValue(
      Buffer.isBuffer(previousManifest) && previousManifest.length <= 65_536,
      'authenticated prior release is required',
    );
    const previous = await verifyManualDownload(previousManifest.toString('utf8'), keySet);
    requireValue(
      compareCommercialVersions(previous.version, release.version) < 0 &&
        previous.sourceSha !== release.sourceSha,
      'historical upgrade must start with a distinct older release',
    );
    const step = qualification(
      upgrade,
      context,
      'HistoricalUpgrade',
      [previous.version, release.version],
      [previous.sourceSha, release.sourceSha],
      [previous.artifacts[0], installer],
    );
    installed(step('historical-baseline-install'), previous.version);
    for (const name of [
      'historical-upgrade-install',
      'historical-same-version-reinstall',
      'historical-install-after-uninstall',
    ])
      requireValue(
        installed(step(name), release.version) === asarSha256,
        'upgrade installed a different archive',
      );
    for (const name of [
      'native-historical-create',
      'historical-restart-reopen',
      'historical-upgrade-reopen',
      'historical-reinstall-reopen',
      'historical-restore-reopen',
    ])
      requireValue(
        sameArtifact(step(name).project, upgrade.retainedProject),
        'reopened project differs from retained project',
      );
    for (const name of ['historical-uninstall-retaining-data', 'historical-final-uninstall'])
      requireValue(step(name).exitCode === 0, 'upgrade cleanup did not pass');
    requireValue(
      hash(upgrade.retainedProject?.sha256) &&
        positive(upgrade.retainedProject?.bytes) &&
        hash(upgrade.retainedProfileSentinel?.sha256) &&
        positive(upgrade.retainedProfileSentinel?.bytes),
      'project and profile retention evidence is incomplete',
    );
    upgradeSummary = {
      status: 'passed',
      previousVersion: previous.version,
      previousSourceSha: previous.sourceSha,
      previousManifestSha256: digest(previousManifest),
      profile: 'free',
    };
  }
  requireValue(
    restoration?.exitCode === 0 &&
      restoration.beforeSha256?.toLowerCase() === asarSha256 &&
      restoration.afterSha256?.toLowerCase() === asarSha256,
    'ASAR integrity probe did not restore the qualified archive',
  );
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'release-success-receipt',
    status: 'passed',
    channel: 'commercial-unsigned',
    version: release.version,
    sourceSha: release.sourceSha,
    sourceRef: release.sourceRef,
    publishedAt: release.publishedAt,
    manifestSha256: digest(manifest),
    installer: { name: installer.name, bytes: installer.bytes, sha256: installer.sha256 },
    workflow: {
      repository: context.repository,
      ref: context.workflow,
      runId: context.runId,
      runAttempt: context.runAttempt,
    },
    qualification: {
      launch: 'passed',
      upgrade: upgradeSummary,
      asar: { status: 'passed', restored: true, sha256: asarSha256 },
    },
    dependencyAudit: dependencySummary(dependencyAudit, context, lockfileSha256),
    publicDelivery: deliverySummary(delivery, release, manifest),
    evidenceSha256: {
      launch: summaryHash(launch),
      ...(upgrade === undefined ? {} : { upgrade: summaryHash(upgrade) }),
      restoration: summaryHash(restoration),
      dependencyAudit: summaryHash(dependencyAudit),
      publicDelivery: summaryHash(delivery),
    },
    limitations: [
      'Hosted Windows runner only',
      'Free profile upgrade; paid licence qualification is separate',
      'No hardware qualification',
      'Release signature is not Windows Authenticode signing',
    ],
  };
}

/** Never changes a feed/catalogue or replaces another attempt's success evidence. */
export async function retainReleaseReceipt(input) {
  const payload = await createReleaseReceiptPayload(input);
  const { store, keySet, keyId, privateKeyPem, manifest, firstRelease } = input;
  const published = await store.get(manualDownloadKey(payload.version, 'download-manifest.json'));
  requireValue(same(published, manifest), 'immutable manifest readback differs');
  if (firstRelease) {
    const catalog = await store.get(MANUAL_CATALOG_KEY);
    requireValue(Buffer.isBuffer(catalog), 'first release needs authenticated catalogue evidence');
    const entries = await verifyManualCatalog(catalog.toString('utf8'), keySet);
    requireValue(
      entries.length === 1 &&
        entries[0].release.version === payload.version &&
        entries[0].release.sourceSha === payload.sourceSha,
      'existing history cannot be called a first release',
    );
  }
  const key = createPrivateKey(privateKeyPem);
  requireValue(key.asymmetricKeyType === 'ed25519', 'Ed25519 release key required');
  const bytes = Buffer.from(JSON.stringify(payload));
  const envelope = {
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId,
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, key).toString('base64'),
  };
  await verifySignedEnvelope(envelope, keySet, 'stable');
  const signed = Buffer.from(`${JSON.stringify(envelope)}\n`);
  requireValue(signed.length <= LIMIT, 'compact receipt exceeds its bound');
  const storageKey = `desktop/commercial-manual/releases/${payload.version}/release-receipts/${payload.workflow.runId}-${payload.workflow.runAttempt}.json`;
  const existing = await store.get(storageKey);
  requireValue(existing === null || same(existing, signed), 'immutable success receipt conflicts');
  if (existing === null)
    await store.put(storageKey, signed, {
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  requireValue(same(await store.get(storageKey), signed), 'success receipt readback failed');
  return {
    status: existing === null ? 'retained' : 'already-retained',
    key: storageKey,
    sha256: digest(signed),
  };
}
