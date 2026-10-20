// Verify the public Preview channel after publication, without publishing or installing anything.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PREVIEW_MANIFEST_LIMIT,
  PREVIEW_ORIGIN,
  PREVIEW_PREFIX,
  previewArtifactNames,
  previewAssetUrl,
  verifyPreviewManifest,
} from '../public/desktop-release-manifest.mjs';
import {
  inspectPublicDownloadPage,
  publicDeliveryArguments,
  readPublicObject,
} from './verify-public-desktop-release.mjs';

export const PREVIEW_LATEST_URL = `${PREVIEW_ORIGIN}/${PREVIEW_PREFIX}/latest.json`;
const requireValue = (condition, message) => {
  if (!condition) throw new Error(`Public Preview delivery: ${message}`);
};

export async function verifyPublicPreviewRelease({
  expectedVersion,
  expectedSourceSha,
  keySet,
  fetchRequest = fetch,
}) {
  previewArtifactNames(expectedVersion);
  requireValue(
    typeof expectedSourceSha === 'string' && /^[a-f0-9]{40}$/u.test(expectedSourceSha),
    'invalid source',
  );
  const metadata = (url) =>
    readPublicObject(url, { limit: PREVIEW_MANIFEST_LIMIT, collect: true }, fetchRequest);
  const latest = await metadata(PREVIEW_LATEST_URL);
  const manifest = await verifyPreviewManifest(latest.body.toString('utf8'), keySet);
  requireValue(
    manifest.version === expectedVersion && manifest.sourceSha === expectedSourceSha,
    'latest differs from the expected version or source',
  );
  const immutable = await metadata(
    `${PREVIEW_ORIGIN}/${PREVIEW_PREFIX}/${manifest.version}/release.json`,
  );
  requireValue(latest.body.equals(immutable.body), 'latest and immutable manifest differ');
  const artifacts = [];
  for (const artifact of manifest.artifacts) {
    const received = await readPublicObject(
      previewAssetUrl(manifest.version, artifact.name),
      { limit: artifact.bytes, timeoutMs: 180_000 },
      fetchRequest,
    );
    requireValue(
      received.bytes === artifact.bytes && received.sha256 === artifact.sha256,
      `artifact differs from its signed size or SHA-256: ${artifact.name}`,
    );
    artifacts.push({ name: artifact.name, ...received });
  }
  const finalLatest = await metadata(PREVIEW_LATEST_URL);
  requireValue(latest.body.equals(finalLatest.body), 'latest changed during verification');
  return {
    schemaVersion: 1,
    kind: 'desktop-public-preview-delivery-verification',
    verifiedAt: new Date().toISOString(),
    status: 'verified',
    version: manifest.version,
    sourceSha: manifest.sourceSha,
    manifestSha256: immutable.sha256,
    checks: {
      latestSignature: true,
      immutableManifest: true,
      allArtifactBytes: true,
      latestUnchanged: true,
    },
    objects: {
      latest: { url: latest.url, sha256: latest.sha256, bytes: latest.bytes },
      immutable: { url: immutable.url, sha256: immutable.sha256, bytes: immutable.bytes },
    },
    artifacts,
    website: null,
    installerExecuted: false,
  };
}

export async function verifyPublicPreviewPage(receipt, outputDirectory) {
  const website = await inspectPublicDownloadPage(
    outputDirectory,
    'preview-download-page.png',
    async (page, expect) => {
      await expect(page.locator('#release-status')).toContainText(`Preview ${receipt.version} ·`);
      await page.locator('#preview-downloads > summary').click();
      const suffixes = [
        'windows-x64-setup.exe',
        'macos-x64.dmg',
        'macos-arm64.dmg',
        'release-notes.md',
        'SHA256SUMS.txt',
        'sbom.cdx.json',
      ];
      await expect(page.locator('[data-preview-suffix]')).toHaveCount(suffixes.length);
      for (const suffix of suffixes) {
        const artifact = receipt.artifacts.find(
          ({ name }) => name === `KerfDesk-${receipt.version}-${suffix}`,
        );
        requireValue(artifact !== undefined, 'missing website artifact');
        const link = page.locator(`[data-preview-suffix="${suffix}"]`);
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', artifact.url);
        if (suffix.endsWith('.exe') || suffix.endsWith('.dmg')) {
          const card = page.locator('.card').filter({ has: link });
          await expect(card.locator('.asset-name')).toHaveText(artifact.name);
          await expect(card.locator('.artifact-hash')).toHaveText(`SHA-256: ${artifact.sha256}`);
        }
      }
      await expect(page.locator('#signed-manifest')).toBeVisible();
      await expect(page.locator('#signed-manifest')).toHaveAttribute(
        'href',
        receipt.objects.immutable.url,
      );
    },
  );
  return { ...website, version: receipt.version, manifestUrl: receipt.objects.immutable.url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = publicDeliveryArguments(process.argv.slice(2), previewArtifactNames);
  await mkdir(options.outputDirectory);
  try {
    const keySet = JSON.parse(
      await readFile(new URL('../public/desktop-release-keys.json', import.meta.url), 'utf8'),
    );
    const receipt = await verifyPublicPreviewRelease({ ...options, keySet });
    await writeFile(
      join(options.outputDirectory, 'public-cdn.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: 'wx' },
    );
    if (options.website)
      receipt.website = await verifyPublicPreviewPage(receipt, options.outputDirectory);
    await writeFile(
      join(options.outputDirectory, 'public-delivery.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: 'wx' },
    );
    console.log(`Public Preview delivery verified: ${receipt.version} (${receipt.sourceSha}).`);
  } catch (error) {
    await writeFile(
      join(options.outputDirectory, 'public-delivery-failure.json'),
      `${JSON.stringify({ schemaVersion: 1, status: 'failed', checkedAt: new Date().toISOString(), expectedVersion: options.expectedVersion, expectedSourceSha: options.expectedSourceSha, reason: error.message }, null, 2)}\n`,
      { flag: 'wx' },
    );
    throw error;
  }
}
