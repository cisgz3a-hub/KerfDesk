// Verify the package.json a packaged unsigned commercial app reads from app.asar
// (ADR-610): production licensing, the unsigned lane's markers and exactly the
// release identity the Windows installer of this version carries. The macOS
// and Linux package contracts run it on the bytes inside each DMG, .deb and
// AppImage, not on the build inputs.
//
// usage: node scripts/verify-packaged-commercial-metadata.mjs <app.asar> <version> <identity.json>

import asar from '@electron/asar';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { verifyUnsignedCommercialMetadata } from './prepare-commercial-desktop.mjs';
import {
  assertPackagedArchiveComplete,
  verifyPackagedRendererVersion,
} from './verify-packaged-preview-metadata.mjs';

const PACKAGE_AUTHOR_NAME = 'Johann Stolk';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function verifyPackagedCommercialAsar(archivePath, expectedVersion, identity, keySets) {
  assertPackagedArchiveComplete(archivePath);
  const metadata = JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8'));
  if (metadata?.author?.name !== PACKAGE_AUTHOR_NAME)
    throw new Error(`packaged author mismatch: expected ${PACKAGE_AUTHOR_NAME}`);
  const claims = verifyUnsignedCommercialMetadata(
    metadata,
    keySets.entitlementKeySet,
    keySets.releaseKeySet,
  );
  if (claims.version !== expectedVersion)
    throw new Error(`packaged version mismatch: expected ${expectedVersion}`);
  if (JSON.stringify(metadata.kerfdeskCommercialLicense.release) !== JSON.stringify(identity))
    throw new Error('packaged release identity differs from this release');
  verifyPackagedRendererVersion(archivePath, expectedVersion);
  return claims;
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const [, , archivePath, expectedVersion, identityPath, ...extra] = process.argv;
    if (!archivePath || !expectedVersion || !identityPath || extra.length > 0)
      throw new Error(
        'usage: node scripts/verify-packaged-commercial-metadata.mjs <app.asar> <version> <identity.json>',
      );
    const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
    verifyPackagedCommercialAsar(path.resolve(archivePath), expectedVersion, read(identityPath), {
      entitlementKeySet: read(path.join(ROOT, 'public/desktop-licence-keys.json')),
      releaseKeySet: read(path.join(ROOT, 'public/desktop-release-keys.json')),
    });
    process.stdout.write(`verified packaged commercial metadata for ${expectedVersion}\n`);
  } catch (error) {
    process.stderr.write(`verify-packaged-commercial-metadata: ${error.message}\n`);
    process.exitCode = 1;
  }
}
