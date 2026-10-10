/* global fetch, AbortController, setTimeout, clearTimeout, URLSearchParams, document, location */
import {
  isPreviewVersion,
  PREVIEW_ORIGIN,
  PREVIEW_PREFIX,
  previewAssetUrl,
  readBoundedManifest,
  verifyPreviewManifest,
} from './desktop-release-manifest.mjs';
import {
  COMMERCIAL_CATALOG_LIMIT,
  COMMERCIAL_CATALOG_URL,
  commercialArtifactNames,
  commercialReleaseUrl,
  verifyCommercialCatalog,
} from './desktop-commercial-catalog.mjs';
import {
  MANUAL_DOWNLOAD_LATEST_URL,
  MANUAL_DOWNLOAD_LIMIT,
  manualDownloadUrl,
  verifyManualDownload,
} from './desktop-manual-download.mjs';

function requestOptions(signal) {
  return {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal,
  };
}

function trustAnchors(fetchRequest, options) {
  return fetchRequest('/desktop-release-keys.json', options)
    .then(readBoundedManifest)
    .then(JSON.parse);
}

export async function populatePreviewDownloads(document, search, fetchRequest = fetch) {
  const status = document.getElementById('release-status');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const requested = new URLSearchParams(search).get('version');
    if (requested !== null && !isPreviewVersion(requested))
      throw new Error('Invalid requested version');
    const manifestUrl = `${PREVIEW_ORIGIN}/${PREVIEW_PREFIX}/${requested === null ? 'latest.json' : `${requested}/release.json`}`;
    const options = requestOptions(controller.signal);
    const [text, keys] = await Promise.all([
      fetchRequest(manifestUrl, options).then(readBoundedManifest),
      trustAnchors(fetchRequest, options),
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
    // The separators between these links stay hidden until every link is real.
    document.getElementById('preview-links').hidden = false;
    status.textContent = `Preview ${release.version} · Published ${release.publishedAt.slice(0, 10)} · Publisher signature verified.`;
  } catch {
    for (const link of document.querySelectorAll('[data-preview-suffix], #signed-manifest')) {
      link.hidden = true;
      link.removeAttribute('href');
    }
    document.getElementById('preview-links').hidden = true;
    status.textContent =
      'Verified Preview downloads are currently unavailable. Please try again later. You can continue using the web app.';
  } finally {
    clearTimeout(timeout);
  }
}

const COMMERCIAL_NOT_RELEASED =
  'The licensed Windows edition has not been released yet. Its verified Windows download will appear here when it is; until then, use the free Preview below or the web app.';
// The page cannot tell an unprovisioned or unreachable download host from a transient
// failure, so this wording must stay true whether or not a release exists.
const COMMERCIAL_UNVERIFIED =
  'No verified download of the licensed Windows edition is available right now. Please try again later, or use the free Preview below or the web app.';

// Prefer the signed installer catalogue. Only its absent/empty state permits a
// separately authenticated manual commercial download; invalid stable is an error.
export async function populateCommercialDownload(document, fetchRequest = fetch) {
  const status = document.getElementById('commercial-status');
  const links = [
    document.getElementById('commercial-download'),
    document.getElementById('commercial-manifest'),
  ];
  for (const link of links) {
    link.hidden = true;
    link.removeAttribute('href');
  }
  document.getElementById('commercial-installation').textContent = '';
  showEarlierReleases(document, []);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const options = requestOptions(controller.signal);
    const [catalog, keys] = await Promise.all([
      fetchRequest(COMMERCIAL_CATALOG_URL, options),
      trustAnchors(fetchRequest, options),
    ]);
    // A missing or empty catalogue is the honest "no commercial release yet" state.
    const releases =
      catalog.status === 404
        ? []
        : await verifyCommercialCatalog(
            await readBoundedManifest(catalog, COMMERCIAL_CATALOG_LIMIT),
            keys,
          );
    if (releases.length === 0) {
      if (!(await showManualDownload(document, links, fetchRequest, options, keys)))
        status.textContent = COMMERCIAL_NOT_RELEASED;
      return;
    }
    const [release, ...earlier] = releases;
    const installer = windowsInstaller(release);
    links[0].href = commercialReleaseUrl(release.version, installer.name);
    links[1].href = commercialReleaseUrl(release.version, 'update-manifest.json');
    links[1].textContent = 'Signed update manifest';
    for (const link of links) link.hidden = false;
    document.getElementById('commercial-asset').textContent = installer.name;
    document.getElementById('commercial-hash').textContent = `SHA-256: ${installer.sha256}`;
    showEarlierReleases(document, earlier);
    status.textContent = `KerfDesk ${release.version} · Released ${release.publishedAt.slice(0, 10)} · Publisher signature verified.`;
    document.getElementById('commercial-installation').textContent =
      'This installer is code-signed. If Windows reports an unknown publisher, do not run it; download it again from this page. Updates install only after you quit KerfDesk yourself, never during a job.';
  } catch {
    for (const link of links) {
      link.hidden = true;
      link.removeAttribute('href');
    }
    document.getElementById('commercial-hash').textContent = '';
    showEarlierReleases(document, []);
    status.textContent = COMMERCIAL_UNVERIFIED;
  } finally {
    clearTimeout(timeout);
  }
}

async function showManualDownload(document, links, fetchRequest, options, keys) {
  const response = await fetchRequest(MANUAL_DOWNLOAD_LATEST_URL, options);
  if (response.status === 404) return false;
  const release = await verifyManualDownload(
    await readBoundedManifest(response, MANUAL_DOWNLOAD_LIMIT),
    keys,
  );
  const [installer] = release.artifacts;
  links[0].href = manualDownloadUrl(release.version, installer.name);
  links[1].href = manualDownloadUrl(release.version, 'download-manifest.json');
  links[1].textContent = 'Publisher-signed download manifest';
  for (const link of links) link.hidden = false;
  document.getElementById('commercial-asset').textContent = installer.name;
  document.getElementById('commercial-hash').textContent = `SHA-256: ${installer.sha256}`;
  document.getElementById('commercial-status').textContent =
    `KerfDesk ${release.version} · ${megabytes(installer.bytes)} · Released ${release.publishedAt.slice(0, 10)} · Unsigned installer · Manual updates · Download metadata signature verified.`;
  document.getElementById('commercial-installation').textContent =
    'KerfDesk tells you when an update is ready. Choose Download update, then Install when I close KerfDesk: the installer opens only after you close KerfDesk yourself, never during a job. KerfDesk never downloads or installs unsigned updates without your approval. The download details are signature-checked, but this installer is not Windows code-signed yet, so Windows may warn about an unknown publisher.';
  return true;
}

function megabytes(bytes) {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function windowsInstaller(release) {
  const [name] = commercialArtifactNames(release.version);
  return release.artifacts.find((item) => item.name === name);
}

// Customers whose update year ended still own the versions released before it, so
// every verified older release stays downloadable (built with text nodes, no HTML).
function showEarlierReleases(document, releases) {
  const history = document.getElementById('commercial-history');
  const list = document.getElementById('commercial-history-list');
  list.replaceChildren(
    ...releases.map((release) => {
      const installer = windowsInstaller(release);
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = commercialReleaseUrl(release.version, installer.name);
      link.textContent = `KerfDesk ${release.version}`;
      const detail = document.createElement('span');
      detail.className = 'artifact-hash';
      detail.textContent = ` · Released ${release.publishedAt.slice(0, 10)} · SHA-256: ${installer.sha256}`;
      item.append(link, detail);
      return item;
    }),
  );
  history.hidden = releases.length === 0;
}

if (typeof document !== 'undefined') {
  void populateCommercialDownload(document);
  void populatePreviewDownloads(document, location.search);
}
