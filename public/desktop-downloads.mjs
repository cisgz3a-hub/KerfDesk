/* global fetch, AbortController, setTimeout, clearTimeout, URLSearchParams, document, location */
import {
  isPreviewVersion,
  PREVIEW_ORIGIN,
  PREVIEW_PREFIX,
  previewAssetUrl,
  readBoundedManifest,
  verifyPreviewManifest,
} from './desktop-release-manifest.mjs';

export async function populatePreviewDownloads(document, search, fetchRequest = fetch) {
  const status = document.getElementById('release-status');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const requested = new URLSearchParams(search).get('version');
    if (requested !== null && !isPreviewVersion(requested))
      throw new Error('Invalid requested version');
    const manifestUrl = `${PREVIEW_ORIGIN}/${PREVIEW_PREFIX}/${requested === null ? 'latest.json' : `${requested}/release.json`}`;
    const options = {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    };
    const [text, keys] = await Promise.all([
      fetchRequest(manifestUrl, options).then(readBoundedManifest),
      fetchRequest('/desktop-release-keys.json', options)
        .then(readBoundedManifest)
        .then(JSON.parse),
    ]);
    const release = await verifyPreviewManifest(text, keys);
    if (requested !== null && requested !== release.version)
      throw new Error('Requested version mismatch');
    // No API-provided URL or HTML is inserted into this document.
    for (const link of document.querySelectorAll('[data-preview-suffix]')) {
      const artifact = release.artifacts.find(
        (item) => item.name === `KerfDesk-${release.version}-${link.dataset.previewSuffix}`,
      );
      if (!artifact) throw new Error('Missing platform artifact');
      link.href = previewAssetUrl(release.version, artifact.name);
      link.hidden = false;
      const card = link.closest('.card');
      if (card) {
        card.querySelector('.asset-name').textContent = artifact.name;
        card.querySelector('.artifact-hash').textContent = `SHA-256: ${artifact.sha256}`;
      }
    }
    const manifestLink = document.getElementById('signed-manifest');
    manifestLink.href = `${PREVIEW_ORIGIN}/${PREVIEW_PREFIX}/${release.version}/release.json`;
    manifestLink.hidden = false;
    status.textContent = `Preview ${release.version} · Published ${release.publishedAt.slice(0, 10)} · Publisher signature verified.`;
  } catch {
    for (const link of document.querySelectorAll('[data-preview-suffix], #signed-manifest')) {
      link.hidden = true;
      link.removeAttribute('href');
    }
    status.textContent =
      'Verified Preview downloads are currently unavailable. Please try again later. You can continue using the web app.';
  } finally {
    clearTimeout(timeout);
  }
}
if (typeof document !== 'undefined') void populatePreviewDownloads(document, location.search);
