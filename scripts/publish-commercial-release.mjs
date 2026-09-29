import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stableArtifactNames } from './stable-release-artifacts.mjs';
import { createStableReleaseStore } from './stable-release-store.mjs';
import { commercialSourceRef, verifyCommercialEnvelope } from './commercial-release-manifest.mjs';
import {
  readCommercialPackage,
  createCommercialInstallerVerifier,
  readCommercialInput,
} from './commercial-release-package.mjs';
import { publishCommercialRelease } from './commercial-release-publisher.mjs';

export function requireCommercialPublishContext(env, identity, platform = process.platform) {
  const required = [
    'DESKTOP_STABLE_MANIFEST_PRIVATE_KEY',
    'DESKTOP_STABLE_MANIFEST_KEY_ID',
    'COMMERCIAL_R2_API_TOKEN',
    'COMMERCIAL_CLOUDFLARE_ACCOUNT_ID',
    'DESKTOP_WINDOWS_PUBLISHER_NAME',
  ];
  if (required.some((name) => typeof env[name] !== 'string' || env[name].trim() === ''))
    throw new Error(
      'Commercial publication requires signing key, pinned key ID, explicit publisher and R2 configuration.',
    );
  if (!/^[a-f0-9]{32}$/u.test(env.COMMERCIAL_CLOUDFLARE_ACCOUNT_ID))
    throw new Error('Invalid commercial R2 account ID.');
  // A maintainer's release names its vX.Y.Z tag; the release train names main.
  if (platform !== 'win32' || !commercialSourceRef(identity.version, identity.sourceRef))
    throw new Error(
      'Commercial publication requires Windows and a versioned signed source identity.',
    );
}

export async function requireCommercialSource(identity, root, execute = promisify(execFile)) {
  const options = { cwd: root, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 };
  const { stdout: head } = await execute('git', ['rev-parse', '--verify', 'HEAD'], options);
  const { stdout: changes } = await execute(
    'git',
    ['status', '--porcelain', '--untracked-files=normal'],
    options,
  );
  if (head.trim() !== identity.sourceSha || changes.trim() !== '')
    throw new Error(
      'Publication checkout must be clean and match the signed source SHA; use ignored or external build outputs.',
    );
}

async function main() {
  const [releaseDirectory, identityPath, resourcesDirectory, ...extra] = process.argv.slice(2);
  if (!releaseDirectory || !identityPath || !resourcesDirectory || extra.length)
    throw new Error(
      'Usage: publish-commercial-release.mjs <release-directory> <commercial-release-identity.json> <packaged-resources-directory>',
    );
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
  const identityEnvelope = json(await readCommercialInput(identityPath, 65_536));
  const identity = verifyCommercialEnvelope(identityEnvelope, keySet, 'release-identity');
  requireCommercialPublishContext(process.env, identity);
  await requireCommercialSource(identity, fileURLToPath(new URL('..', import.meta.url)));
  const { updateConfigText, resourceDigests } = await readCommercialPackage(
    resolve(resourcesDirectory),
    identityEnvelope,
    keySet,
    process.env.DESKTOP_WINDOWS_PUBLISHER_NAME,
    entitlementKeySet,
  );
  const files = await Promise.all(
    stableArtifactNames(identity.version).map(async (name) => ({
      name,
      bytes: await readCommercialInput(
        join(releaseDirectory, name),
        name === 'latest.yml' ? 65_536 : 300_000_000,
      ),
    })),
  );
  const verifyInstaller = createCommercialInstallerVerifier({
    updateConfigText,
    resourceDigests,
    expectedPublisher: process.env.DESKTOP_WINDOWS_PUBLISHER_NAME,
  });
  const store = await createStableReleaseStore({
    accountId: process.env.COMMERCIAL_CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.COMMERCIAL_R2_API_TOKEN,
  });
  const result = await publishCommercialRelease({
    release: { identity: identityEnvelope, files },
    store,
    keySet,
    privateKeyPem: process.env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY,
    keyId: process.env.DESKTOP_STABLE_MANIFEST_KEY_ID,
    verifyInstaller,
  });
  console.log(`Commercial release ${result.version}: ${result.status} to the beta ring.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {
    console.error(
      'Commercial publication failed. Check the signed identity, native signer, clean source checkout, immutable artifacts and protected R2 configuration.',
    );
    process.exitCode = 1;
  });
