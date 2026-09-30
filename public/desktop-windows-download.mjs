/* global fetch, AbortController, setTimeout, clearTimeout */
import { readBoundedManifest } from './desktop-release-manifest.mjs';
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

const DEADLINE_MS = 8_000;
const ANCHORS_LIMIT = 16_384;
class DownloadFailure extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

async function request(fetchRequest, url, signal) {
  try {
    return await fetchRequest(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal,
    });
  } catch {
    throw new DownloadFailure('network');
  }
}

async function resolveRelease(fetchRequest, signal) {
  const catalog = await request(fetchRequest, COMMERCIAL_CATALOG_URL, signal);
  if (catalog.status === 404) return resolveManualRelease(fetchRequest, signal);
  if (catalog.status !== 200) throw new DownloadFailure('network');
  // Trust comes from this website's own pins, never from the download host.
  const [text, keys] = await Promise.all([
    readBoundedManifest(catalog, COMMERCIAL_CATALOG_LIMIT),
    trustAnchors(fetchRequest, signal),
  ]);
  const [release] = await verifyCommercialCatalog(text, keys);
  if (release === undefined) return resolveManualRelease(fetchRequest, signal, keys);
  const [fileName] = commercialArtifactNames(release.version);
  const installer = release.artifacts.find((artifact) => artifact.name === fileName);
  if (installer === undefined) throw new DownloadFailure('invalid-release');
  return {
    status: 'ready',
    version: release.version,
    url: commercialReleaseUrl(release.version, fileName),
    fileName,
    sha256: installer.sha256,
    bytes: installer.bytes,
    publishedAt: release.publishedAt,
    codeSigning: 'signed',
    updates: 'automatic',
  };
}

async function trustAnchors(fetchRequest, signal) {
  const response = await request(fetchRequest, '/desktop-release-keys.json', signal);
  if (response.status !== 200) throw new DownloadFailure('network');
  return JSON.parse(await readBoundedManifest(response, ANCHORS_LIMIT));
}

async function resolveManualRelease(fetchRequest, signal, keys) {
  const response = await request(fetchRequest, MANUAL_DOWNLOAD_LATEST_URL, signal);
  if (response.status === 404) return { status: 'unavailable', reason: 'not-released' };
  if (response.status !== 200) throw new DownloadFailure('network');
  const release = await verifyManualDownload(
    await readBoundedManifest(response, MANUAL_DOWNLOAD_LIMIT),
    keys ?? (await trustAnchors(fetchRequest, signal)),
  );
  const [installer] = release.artifacts;
  return {
    status: 'ready',
    version: release.version,
    url: manualDownloadUrl(release.version, installer.name),
    fileName: installer.name,
    sha256: installer.sha256,
    bytes: installer.bytes,
    publishedAt: release.publishedAt,
    codeSigning: 'unsigned',
    updates: 'manual',
  };
}

/** Resolve stable-key-authenticated Windows Pro metadata; never download an installer or use Preview. */
export async function resolveWindowsDesktopDownload({
  signal,
  fetchRequest = fetch,
  timeoutMs = DEADLINE_MS,
} = {}) {
  if (signal?.aborted) return { status: 'error', reason: 'aborted' };
  const controller = new AbortController();
  let finishCancellation;
  const cancelled = new Promise((resolve) => {
    finishCancellation = resolve;
  });
  const cancel = (reason) => {
    finishCancellation({ status: 'error', reason });
    controller.abort();
  };
  const abort = () => cancel('aborted');
  signal?.addEventListener('abort', abort, { once: true });
  // Tests/callers may shorten the deadline, but can never make this request unbounded.
  const duration =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, DEADLINE_MS) : DEADLINE_MS;
  const timeout = setTimeout(() => cancel('timeout'), duration);
  try {
    // The deadline also bounds body reads, cancellation and verification, including
    // a fetch implementation that fails to settle after its signal is aborted.
    return await Promise.race([
      resolveRelease(fetchRequest, controller.signal).catch((error) => ({
        status: 'error',
        reason: error instanceof DownloadFailure ? error.reason : 'invalid-release',
      })),
      cancelled,
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}
