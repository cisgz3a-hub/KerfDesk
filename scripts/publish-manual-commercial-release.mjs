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
import { createStableReleaseStore, ReleaseRateLimitError } from './stable-release-store.mjs';
import { commercialArtifactNames } from '../public/desktop-commercial-catalog.mjs';
import { publishManualCommercialRelease } from './manual-commercial-publisher.mjs';
import {
  readUnsignedCommercialPackage,
  createUnsignedCommercialInstallerVerifier,
} from './unsigned-commercial-package.mjs';

const USAGE =
  'Usage: publish-manual-commercial-release.mjs --expected-latest-sha256 <64-hex|none> <release-directory> <commercial-release-identity.json> <packaged-resources-directory>';

export function parseManualPublicationArguments(args) {
  const flag = args.indexOf('--expected-latest-sha256');
  const expectedLatestSha256 = flag === -1 ? undefined : args[flag + 1]?.toLowerCase();
  const paths =
    flag === -1 ? args : args.filter((_, index) => index !== flag && index !== flag + 1);
  if (
    !/^(?:none|[a-f0-9]{64})$/u.test(expectedLatestSha256 ?? '') ||
    paths.length !== 3 ||
    paths.some((path) => !path || path.startsWith('--'))
  )
    throw new CommercialReleaseError(USAGE);
  const [releaseDirectory, identityPath, resourcesDirectory] = paths;
  return { expectedLatestSha256, releaseDirectory, identityPath, resourcesDirectory };
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
  const { expectedLatestSha256, releaseDirectory, identityPath, resourcesDirectory } =
    parseManualPublicationArguments(process.argv.slice(2));
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
    console.error(
      printableRefusal(error) ??
        'Manual commercial publication failed. Check trusted release identity, unsigned package, source checkout and protected R2 configuration.',
    );
    process.exitCode = 1;
  });
