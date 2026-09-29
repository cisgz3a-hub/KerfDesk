// Independent offline verification: use keys obtained from a trusted KerfDesk
// installation/site, not a key supplied alongside an untrusted download.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyPreviewManifest } from '../public/desktop-release-manifest.mjs';
import { sha256 } from './preview-release-publisher.mjs';

const [manifestPath, trustedKeysPath, artifactDirectory] = process.argv.slice(2);
try {
  if (!manifestPath || !trustedKeysPath)
    throw new Error(
      'Usage: verify-preview-release.mjs <release.json> <trusted-keys.json> [artifact-directory]',
    );
  const release = await verifyPreviewManifest(
    await readFile(manifestPath, 'utf8'),
    JSON.parse(await readFile(trustedKeysPath, 'utf8')),
  );
  if (artifactDirectory) {
    for (const artifact of release.artifacts) {
      const bytes = await readFile(join(artifactDirectory, artifact.name));
      if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256)
        throw new Error(`Artifact digest mismatch: ${artifact.name}`);
    }
  }
  console.log(
    `Verified publisher signature for ${release.version}${artifactDirectory ? ' and every artifact hash' : ''}. Provenance: ${release.provenance.kind}.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
