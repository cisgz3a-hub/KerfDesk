import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractFile } from '@electron/asar';
import { verifyCommercialEnvelope } from './commercial-release-manifest.mjs';
import { verifyUnsignedCommercialMetadata } from './prepare-commercial-desktop.mjs';
import { verifyDesktopRendererAsar } from './verify-desktop-renderer.mjs';
import { verifyPackagedRendererVersion } from './verify-packaged-preview-metadata.mjs';

/** Historical legal/dependency notices belong to their source, not today's tree. */
export async function verifyHistoricalInstalledResources(resources, version, sourceSha) {
  if (!/^\d+\.\d+\.\d+$/u.test(version) || !/^[a-f0-9]{40}$/u.test(sourceSha))
    throw new Error('Expected stable historical version and full source SHA.');
  const archive = join(resolve(resources), 'app.asar');
  const metadata = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
  const publicJson = async (name) =>
    JSON.parse(await readFile(new URL(`../public/${name}`, import.meta.url)));
  const [releaseKeys, entitlementKeys] = await Promise.all([
    publicJson('desktop-release-keys.json'),
    publicJson('desktop-licence-keys.json'),
  ]);
  verifyUnsignedCommercialMetadata(metadata, entitlementKeys, releaseKeys);
  const identity = verifyCommercialEnvelope(
    metadata.kerfdeskCommercialLicense.release,
    releaseKeys,
    'release-identity',
  );
  assert.equal(identity.version, version, 'Installed version differs from the signed download');
  assert.equal(identity.sourceSha, sourceSha, 'Installed source differs from the signed download');
  assert.equal(metadata.version, version);
  await readFile(join(resources, 'app-update.yml')).then(
    () => {
      throw new Error('Historical unsigned installer enables automatic updates.');
    },
    (error) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third-party-notices.txt']) {
    if (!(await readFile(join(resources, 'legal', name))).length)
      throw new Error('Historical package is missing a required legal notice.');
  }
  verifyDesktopRendererAsar(archive);
  verifyPackagedRendererVersion(archive, version);
  return {
    version,
    sourceSha,
    channel: identity.channel,
    manualUpdates: true,
    trustedUpdater: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [resources, version, sourceSha, ...extra] = process.argv.slice(2);
  if (!resources || !version || !sourceSha || extra.length)
    throw new Error('Expected installed resources, version and source SHA.');
  console.log(
    JSON.stringify(await verifyHistoricalInstalledResources(resources, version, sourceSha)),
  );
}
