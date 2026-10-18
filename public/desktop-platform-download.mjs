/* global TextEncoder */
// The macOS and Linux downloads of the unsigned commercial lane (ADR-613). Each
// system has its own signed document beside the Windows one: installed Windows
// copies check commercial-manual/latest.json against exactly one Windows
// installer (desktop-manual-download.mjs), so that document never names these
// files. The stable publisher signature authenticates the files; it is not Apple
// code signing or notarization and never authorizes an automatic installation.
import { verifySignedEnvelope } from './desktop-release-manifest.mjs';
import { COMMERCIAL_ORIGIN, commercialArtifactNames } from './desktop-commercial-catalog.mjs';
import { MANUAL_DOWNLOAD_PREFIX } from './desktop-manual-download.mjs';

export const PLATFORM_DOWNLOAD_LIMIT = 65_536;
export const DOWNLOAD_PLATFORMS = ['macos', 'linux'];

// Exact files per system, in the order the page shows them, and the signing
// values each system may carry ('developer-id' lets the first notarized Mac
// build reach unsigned Mac copies once, as 'authenticode' does on Windows).
const PLATFORMS = {
  macos: {
    files: (version) => [
      `KerfDesk-${version}-macos-arm64.dmg`,
      `KerfDesk-${version}-macos-x64.dmg`,
    ],
    codeSigning: ['unsigned', 'developer-id'],
  },
  linux: {
    files: (version) => [
      `KerfDesk-${version}-linux-amd64.deb`,
      `KerfDesk-${version}-linux-x86_64.AppImage`,
    ],
    codeSigning: ['unsigned'],
  },
};

const exact = (value, fields) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...fields].sort().join(',');
function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid platform desktop download: ${message}`);
}
function requirePlatform(platform) {
  requireValue(DOWNLOAD_PLATFORMS.includes(platform), 'platform');
  return PLATFORMS[platform];
}

/** The exact files a release publishes for one system. */
export function platformArtifactNames(platform, version) {
  // The Windows names validate the version with the same strict X.Y.Z rule.
  commercialArtifactNames(version);
  return requirePlatform(platform).files(version);
}

export function platformLatestKey(platform) {
  requirePlatform(platform);
  return `${MANUAL_DOWNLOAD_PREFIX}/latest-${platform}.json`;
}

export function platformLatestUrl(platform) {
  return `${COMMERCIAL_ORIGIN}/${platformLatestKey(platform)}`;
}

export function platformManifestName(platform) {
  requirePlatform(platform);
  return `download-manifest-${platform}.json`;
}

export function platformDownloadKey(platform, version, name) {
  requireValue(
    [...platformArtifactNames(platform, version), platformManifestName(platform)].includes(name),
    'artifact name',
  );
  return `${MANUAL_DOWNLOAD_PREFIX}/releases/${version}/${name}`;
}

export function platformDownloadUrl(platform, version, name) {
  return `${COMMERCIAL_ORIGIN}/${platformDownloadKey(platform, version, name)}`;
}

export function validatePlatformDownload(value, now = Date.now()) {
  requireValue(
    exact(value, [
      'schemaVersion',
      'product',
      'kind',
      'channel',
      'platform',
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
      value.kind === 'platform-download' &&
      value.channel === 'stable' &&
      value.updates === 'manual',
    'payload identity',
  );
  const platform = requirePlatform(value.platform);
  requireValue(platform.codeSigning.includes(value.codeSigning), 'code signing');
  const names = platformArtifactNames(value.platform, value.version);
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
  // Every file once, in the published order, so one release has one document.
  requireValue(
    Array.isArray(value.artifacts) && value.artifacts.length === names.length,
    'artifact count',
  );
  value.artifacts.forEach((artifact, index) => {
    requireValue(
      exact(artifact, ['name', 'bytes', 'sha256']) && artifact.name === names[index],
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
  });
  return value;
}

/** Verifies one system's signed document; `platform` must match what it names. */
export async function verifyPlatformDownload(text, keySet, platform, now = Date.now()) {
  requirePlatform(platform);
  requireValue(
    typeof text === 'string' && new TextEncoder().encode(text).length <= PLATFORM_DOWNLOAD_LIMIT,
    'size',
  );
  const release = validatePlatformDownload(
    await verifySignedEnvelope(JSON.parse(text), keySet, 'stable'),
    now,
  );
  requireValue(release.platform === platform, 'platform');
  return release;
}
