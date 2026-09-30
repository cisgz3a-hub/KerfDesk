/* global TextEncoder */
// Stable publisher signatures authenticate these manual downloads. They do not
// constitute Windows code signing and never authorize automatic installation.
import { verifySignedEnvelope } from './desktop-release-manifest.mjs';
import { COMMERCIAL_ORIGIN, commercialArtifactNames } from './desktop-commercial-catalog.mjs';

export const MANUAL_DOWNLOAD_PREFIX = 'desktop/commercial-manual';
export const MANUAL_DOWNLOAD_LATEST_KEY = `${MANUAL_DOWNLOAD_PREFIX}/latest.json`;
export const MANUAL_DOWNLOAD_LATEST_URL = `${COMMERCIAL_ORIGIN}/${MANUAL_DOWNLOAD_LATEST_KEY}`;
export const MANUAL_DOWNLOAD_LIMIT = 65_536;
const exact = (value, fields) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...fields].sort().join(',');
function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid manual desktop download: ${message}`);
}

export function manualDownloadKey(version, name) {
  const [installer] = commercialArtifactNames(version);
  requireValue([installer, 'download-manifest.json'].includes(name), 'artifact name');
  return `${MANUAL_DOWNLOAD_PREFIX}/releases/${version}/${name}`;
}

export function manualDownloadUrl(version, name) {
  return `${COMMERCIAL_ORIGIN}/${manualDownloadKey(version, name)}`;
}

export function validateManualDownload(value, now = Date.now()) {
  requireValue(
    exact(value, [
      'schemaVersion',
      'product',
      'kind',
      'channel',
      'version',
      'sourceSha',
      'sourceRef',
      'publishedAt',
      'codeSigning',
      'updates',
      'artifacts',
    ]),
    'payload fields',
  );
  requireValue(
    value.schemaVersion === 1 &&
      value.product === 'kerfdesk-desktop' &&
      value.kind === 'manual-download' &&
      value.channel === 'stable' &&
      value.codeSigning === 'unsigned' &&
      value.updates === 'manual',
    'payload identity',
  );
  const [installer] = commercialArtifactNames(value.version);
  requireValue(
    typeof value.sourceSha === 'string' &&
      /^[a-f0-9]{40}$/u.test(value.sourceSha) &&
      (value.sourceRef === `refs/tags/v${value.version}` || value.sourceRef === 'refs/heads/main'),
    'source',
  );
  const time = typeof value.publishedAt === 'string' ? Date.parse(value.publishedAt) : NaN;
  requireValue(
    Number.isFinite(time) &&
      time > 0 &&
      new Date(time).toISOString() === value.publishedAt &&
      time <= now + 300_000,
    'publication time',
  );
  requireValue(Array.isArray(value.artifacts) && value.artifacts.length === 1, 'artifact count');
  const artifact = value.artifacts[0];
  requireValue(
    exact(artifact, ['name', 'bytes', 'sha256']) && artifact.name === installer,
    'artifact identity',
  );
  requireValue(
    Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= 300_000_000,
    'artifact size',
  );
  requireValue(
    typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(artifact.sha256),
    'artifact digest',
  );
  return value;
}

export async function verifyManualDownload(text, keySet, now = Date.now()) {
  requireValue(
    typeof text === 'string' && new TextEncoder().encode(text).length <= MANUAL_DOWNLOAD_LIMIT,
    'size',
  );
  return validateManualDownload(
    await verifySignedEnvelope(JSON.parse(text), keySet, 'stable'),
    now,
  );
}
