import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractFile } from '@electron/asar';
import { verifyCommercialEnvelope } from './commercial-release-manifest.mjs';
import { readUnsignedCommercialPackage } from './unsigned-commercial-package.mjs';
import {
  assertPackagedArchiveComplete,
  verifyPackagedRendererVersion,
} from './verify-packaged-preview-metadata.mjs';

/** Verify installed bytes using source-owned anchors, never caller-provided keys. */
export async function verifyInstalledUnsignedCommercial(resources, version, sourceSha) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version ?? '') ||
    !/^[a-f0-9]{40}$/u.test(sourceSha ?? '')
  )
    throw new Error('Expected a stable version and full source SHA.');
  const archive = join(resolve(resources), 'app.asar');
  assertPackagedArchiveComplete(archive);
  const metadata = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
  const json = async (name) =>
    JSON.parse(await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8'));
  const keys = await json('desktop-release-keys.json');
  const entitlementKeys = await json('desktop-licence-keys.json');
  const identity = metadata.kerfdeskCommercialLicense?.release;
  const release = verifyCommercialEnvelope(identity, keys, 'release-identity');
  if (release.version !== version || release.sourceSha !== sourceSha)
    throw new Error('Installed production release differs from the expected version/source.');
  await readUnsignedCommercialPackage(resolve(resources), identity, keys, entitlementKeys);
  verifyPackagedRendererVersion(archive, version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [resources, version, sourceSha, ...extra] = process.argv.slice(2);
  Promise.resolve()
    .then(() => {
      if (!resources || extra.length > 0)
        throw new Error('Expected resources, version and source SHA.');
      return verifyInstalledUnsignedCommercial(resources, version, sourceSha);
    })
    .then(() => console.log(`Verified installed production unsigned release ${version}.`))
    .catch(() => {
      console.error(
        'Installed unsigned commercial verification failed: check signed identity, pinned keys, source, renderer, notices and updater policy.',
      );
      process.exitCode = 1;
    });
}
