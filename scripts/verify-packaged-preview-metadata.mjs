// Verify the package.json that Electron will read from app.asar at runtime.
// Passing builder flags is not sufficient: notification/updater trust depends
// on the metadata that actually lands inside each packaged application.

import asar from '@electron/asar';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const RENDERER_INDEX_PATTERN = /^dist\/web\/assets\/index-[^/]+\.js$/;

export function verifyPackagedPreviewMetadata(value, expectedVersion) {
  if (typeof value !== 'object' || value === null) {
    throw new Error('packaged package.json must contain an object');
  }
  if (value.version !== expectedVersion) {
    throw new Error(`packaged version mismatch: expected ${expectedVersion}`);
  }
  if (value.kerfdeskDesktopReleaseChannel !== 'preview') {
    throw new Error('packaged Preview channel marker is missing');
  }
  if (value.kerfdeskUpdateChannelTrusted !== false) {
    throw new Error('packaged Preview updater trust must be exactly false');
  }
}

export function verifyPackagedRendererVersion(archivePath, expectedVersion) {
  const rendererEntries = asar
    .listPackage(archivePath, { isPack: false })
    .map((entry) => ({
      archivePath: entry.replace(/^[/\\]+/, ''),
      normalizedPath: entry.replaceAll('\\', '/').replace(/^\/+/, ''),
    }))
    .filter((entry) => RENDERER_INDEX_PATTERN.test(entry.normalizedPath));
  if (rendererEntries.length !== 1) {
    throw new Error(
      `expected exactly one packaged renderer index, found ${rendererEntries.length}`,
    );
  }
  const rendererSource = asar
    .extractFile(archivePath, rendererEntries[0].archivePath)
    .toString('utf8');
  if (!rendererSource.includes(expectedVersion)) {
    throw new Error(`renderer version mismatch: expected ${expectedVersion}`);
  }
}

export function verifyPackagedPreviewAsar(archivePath, expectedVersion) {
  const packageJson = JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8'));
  verifyPackagedPreviewMetadata(packageJson, expectedVersion);
  verifyPackagedRendererVersion(archivePath, expectedVersion);
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const [, , archivePath, expectedVersion, ...extra] = process.argv;
    if (archivePath === undefined || expectedVersion === undefined || extra.length > 0) {
      throw new Error(
        'usage: node scripts/verify-packaged-preview-metadata.mjs <app.asar> <version>',
      );
    }
    verifyPackagedPreviewAsar(path.resolve(archivePath), expectedVersion);
    process.stdout.write(`verified packaged Preview metadata for ${expectedVersion}\n`);
  } catch (error) {
    process.stderr.write(`verify-packaged-preview-metadata: ${error.message}\n`);
    process.exitCode = 1;
  }
}
