// Operator and workflow entry point for one system's commercial macOS or Linux
// release (ADR-610). The release must already be public on Windows.
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import {
  CommercialReleaseError,
  printableRefusal,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';
import { readCommercialInput } from './commercial-release-package.mjs';
import { requireCommercialSource } from './publish-commercial-release.mjs';
import {
  createStableReleaseStore,
  printableStorageFailure,
  ReleaseRateLimitError,
} from './stable-release-store.mjs';
import {
  DOWNLOAD_PLATFORMS,
  platformArtifactNames,
} from '../public/desktop-platform-download.mjs';
import { publishPlatformCommercialRelease } from './platform-commercial-publisher.mjs';

const USAGE =
  'Usage: publish-platform-commercial-release.mjs --platform <macos|linux> --sha256 <file>=<64-hex> [--sha256 ...] <release-directory> <commercial-release-identity.json>';

export function platformPublicationFailure(error, env = process.env) {
  return (
    printableStorageFailure(error) ??
    printableRefusal(error, env) ??
    'Platform commercial publication failed. Check the trusted release identity, qualified files, source checkout and protected R2 configuration.'
  );
}

export function parsePlatformPublicationArguments(args) {
  const rest = [];
  const expected = new Map();
  let platform;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name !== '--platform' && name !== '--sha256') {
      if (name.startsWith('--')) throw new CommercialReleaseError(USAGE);
      rest.push(name);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new CommercialReleaseError(USAGE);
    index += 1;
    if (name === '--platform') {
      if (platform !== undefined || !DOWNLOAD_PLATFORMS.includes(value))
        throw new CommercialReleaseError(USAGE);
      platform = value;
      continue;
    }
    const match = /^([A-Za-z0-9._-]{1,128})=([a-f0-9]{64})$/u.exec(value);
    if (match === null || expected.has(match[1])) throw new CommercialReleaseError(USAGE);
    expected.set(match[1], match[2]);
  }
  if (platform === undefined || rest.length !== 2 || expected.size === 0)
    throw new CommercialReleaseError(USAGE);
  const [releaseDirectory, identityPath] = rest;
  return { platform, expected, releaseDirectory, identityPath };
}

export function requirePlatformPublicationContext(env) {
  const required = [
    'DESKTOP_STABLE_MANIFEST_PRIVATE_KEY',
    'DESKTOP_STABLE_MANIFEST_KEY_ID',
    'COMMERCIAL_R2_API_TOKEN',
    'COMMERCIAL_CLOUDFLARE_ACCOUNT_ID',
  ];
  if (
    required.some((name) => typeof env[name] !== 'string' || env[name].trim() === '') ||
    !/^[a-f0-9]{32}$/u.test(env.COMMERCIAL_CLOUDFLARE_ACCOUNT_ID ?? '')
  )
    throw new CommercialReleaseError(
      'Platform commercial publication requires the stable signing key and explicit R2 account configuration.',
    );
}

async function main() {
  const { platform, expected, releaseDirectory, identityPath } =
    parsePlatformPublicationArguments(process.argv.slice(2));
  requirePlatformPublicationContext(process.env);
  const json = (bytes) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const keySet = json(
    await readCommercialInput(
      new URL('../public/desktop-release-keys.json', import.meta.url),
      16_384,
    ),
  );
  const identity = json(await readCommercialInput(identityPath, 65_536));
  const release = verifyCommercialEnvelope(identity, keySet, 'release-identity');
  await requireCommercialSource(release, fileURLToPath(new URL('..', import.meta.url)));
  const files = new Map();
  for (const name of platformArtifactNames(platform, release.version))
    files.set(name, await readCommercialInput(join(releaseDirectory, name), 300_000_000));
  const store = await createStableReleaseStore({
    accountId: process.env.COMMERCIAL_CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.COMMERCIAL_R2_API_TOKEN,
  });
  const result = await publishPlatformCommercialRelease({
    identity,
    platform,
    files,
    expected,
    store,
    keySet,
    privateKeyPem: process.env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY,
    keyId: process.env.DESKTOP_STABLE_MANIFEST_KEY_ID,
  });
  console.log(
    `Commercial ${platform} release ${result.version}: ${result.status}. Latest SHA-256: ${result.latestSha256}. Unsigned; manual updates only.`,
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
    console.error(platformPublicationFailure(error));
    process.exitCode = 1;
  });
