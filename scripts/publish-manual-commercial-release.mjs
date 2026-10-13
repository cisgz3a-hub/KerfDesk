import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CommercialReleaseError,
  printableRefusal,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';
import { readCommercialInput } from './commercial-release-package.mjs';
import { requireCommercialSource } from './publish-commercial-release.mjs';
import { setTimeout } from 'node:timers/promises';
import {
  createStableReleaseStore,
  printableStorageFailure,
  ReleaseRateLimitError,
} from './stable-release-store.mjs';
import { commercialArtifactNames } from '../public/desktop-commercial-catalog.mjs';
import { publishManualCommercialRelease } from './manual-commercial-publisher.mjs';
import { readReviewedDesktopUpdateNotes } from './reviewed-desktop-update-notes.mjs';
import {
  readUnsignedCommercialPackage,
  createUnsignedCommercialInstallerVerifier,
} from './unsigned-commercial-package.mjs';

const USAGE =
  'Usage: publish-manual-commercial-release.mjs --expected-latest-sha256 <64-hex|none> [--reviewed-history <file>] <release-directory> <commercial-release-identity.json> <packaged-resources-directory>';

export function manualPublicationFailure(error, env = process.env) {
  return (
    printableStorageFailure(error) ??
    printableRefusal(error, env) ??
    'Manual commercial publication failed. Check trusted release identity, unsigned package, source checkout and protected R2 configuration.'
  );
}

export function parseManualPublicationArguments(args) {
  const paths = [...args];
  const option = (name) => {
    const index = paths.indexOf(name);
    if (index === -1) return undefined;
    const value = paths[index + 1];
    if (!value || value.startsWith('--') || paths.lastIndexOf(name) !== index)
      throw new CommercialReleaseError(USAGE);
    paths.splice(index, 2);
    return value;
  };
  const expectedLatestSha256 = option('--expected-latest-sha256')?.toLowerCase();
  const reviewedHistoryPath = option('--reviewed-history');
  if (
    !/^(?:none|[a-f0-9]{64})$/u.test(expectedLatestSha256 ?? '') ||
    paths.length !== 3 ||
    paths.some((path) => !path || path.startsWith('--'))
  )
    throw new CommercialReleaseError(USAGE);
  const [releaseDirectory, identityPath, resourcesDirectory] = paths;
  return {
    expectedLatestSha256,
    releaseDirectory,
    identityPath,
    resourcesDirectory,
    ...(reviewedHistoryPath === undefined ? {} : { reviewedHistoryPath }),
  };
}

export function requireManualPublicationContext(env, platform = process.platform) {
  const required = [
    'DESKTOP_STABLE_MANIFEST_PRIVATE_KEY',
    'DESKTOP_STABLE_MANIFEST_KEY_ID',
    'COMMERCIAL_R2_API_TOKEN',
    'COMMERCIAL_CLOUDFLARE_ACCOUNT_ID',
  ];
  if (
    platform !== 'win32' ||
    required.some((name) => typeof env[name] !== 'string' || env[name].trim() === '') ||
    !/^[a-f0-9]{32}$/u.test(env.COMMERCIAL_CLOUDFLARE_ACCOUNT_ID ?? '')
  )
    throw new CommercialReleaseError(
      'Manual commercial publication requires Windows, stable signing key and explicit R2 account configuration.',
    );
}

async function main() {
  const {
    expectedLatestSha256,
    releaseDirectory,
    identityPath,
    resourcesDirectory,
    reviewedHistoryPath,
  } = parseManualPublicationArguments(process.argv.slice(2));
  requireManualPublicationContext(process.env);
  const json = (bytes) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const keySet = json(
    await readCommercialInput(
      new URL('../public/desktop-release-keys.json', import.meta.url),
      16_384,
    ),
  );
  const entitlementKeySet = json(
    await readCommercialInput(
      new URL('../public/desktop-licence-keys.json', import.meta.url),
      16_384,
    ),
  );
  const identity = json(await readCommercialInput(identityPath, 65_536));
  const release = verifyCommercialEnvelope(identity, keySet, 'release-identity');
  await requireCommercialSource(release, fileURLToPath(new URL('..', import.meta.url)));
  const reviewedNotes = await readReviewedDesktopUpdateNotes(
    release.sourceSha,
    fileURLToPath(new URL('..', import.meta.url)),
  );
  const reviewedHistory =
    reviewedHistoryPath === undefined
      ? undefined
      : json(await readCommercialInput(reviewedHistoryPath, 524_288));
  const { resourceDigests } = await readUnsignedCommercialPackage(
    resolve(resourcesDirectory),
    identity,
    keySet,
    entitlementKeySet,
  );
  const installer = await readCommercialInput(
    join(releaseDirectory, commercialArtifactNames(release.version)[0]),
    300_000_000,
  );
  const verifyInstaller = createUnsignedCommercialInstallerVerifier({ resourceDigests });
  // Refuse package mistakes locally before contacting R2 at all.
  await verifyInstaller(installer, 'preflight');
  const store = await createStableReleaseStore({
    accountId: process.env.COMMERCIAL_CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.COMMERCIAL_R2_API_TOKEN,
  });
  const result = await publishManualCommercialRelease({
    identity,
    installer,
    store,
    keySet,
    verifyInstaller,
    expectedLatestSha256,
    reviewedNotes,
    reviewedHistory,
    privateKeyPem: process.env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY,
    keyId: process.env.DESKTOP_STABLE_MANIFEST_KEY_ID,
  });
  console.log(
    `Manual commercial release ${result.version}: ${result.status}. Latest SHA-256: ${result.latestSha256}. Unsigned installer; manual updates only.`,
  );
}

async function publishWithRateLimitRetry() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await main();
    } catch (error) {
      if (!(error instanceof ReleaseRateLimitError) || attempt >= 3 || error.retryAfterMs > 600_000)
        throw error;
      console.log(
        `Release storage rate limited; retrying the same verified publication in ${Math.ceil(error.retryAfterMs / 1000)} seconds.`,
      );
      await setTimeout(error.retryAfterMs);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  publishWithRateLimitRetry().catch((error) => {
    console.error(manualPublicationFailure(error));
    process.exitCode = 1;
  });
