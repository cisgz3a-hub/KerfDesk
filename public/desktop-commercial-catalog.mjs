/* global atob, btoa, TextEncoder */
// Browser check of the separate commercial Windows catalogue (ADR-523). It mirrors
// scripts/commercial-release-manifest.mjs, which signs and publishes that catalogue;
// only a key the website anchors for the stable channel can authorize a release.
import { verifySignedEnvelope } from './desktop-release-manifest.mjs';

export const COMMERCIAL_ORIGIN = 'https://dl.kerfdesk.com';
export const COMMERCIAL_PREFIX = 'desktop/commercial';
export const COMMERCIAL_CATALOG_URL = `${COMMERCIAL_ORIGIN}/${COMMERCIAL_PREFIX}/catalog.json`;
export const COMMERCIAL_CATALOG_LIMIT = 256 * 1024;
const VERSION = /^(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})$/u;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) =>
  record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid commercial catalogue: ${message}`);
}

export function commercialArtifactNames(version) {
  requireValue(typeof version === 'string' && VERSION.test(version), 'version');
  const installer = `KerfDesk-${version}-windows-x64-setup.exe`;
  return [installer, `${installer}.blockmap`, 'latest.yml'];
}

export function commercialReleaseUrl(version, name) {
  requireValue(
    name === 'update-manifest.json' || commercialArtifactNames(version).includes(name),
    'artifact name',
  );
  return `${COMMERCIAL_ORIGIN}/${COMMERCIAL_PREFIX}/releases/${version}/${name}`;
}

export function compareCommercialVersions(left, right) {
  const a = VERSION.exec(left)?.slice(1).map(BigInt);
  const b = VERSION.exec(right)?.slice(1).map(BigInt);
  requireValue(a !== undefined && b !== undefined, 'version');
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

function canonicalSha512(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/u.test(value)) return false;
  const decoded = atob(value);
  return decoded.length === 64 && btoa(decoded) === value;
}

// The signed update manifest binds the release identity to its three update files.
export function validateCommercialRelease(value, now = Date.now()) {
  requireValue(
    exactKeys(value, [
      'schemaVersion',
      'product',
      'kind',
      'channel',
      'version',
      'sourceSha',
      'sourceRef',
      'publishedAt',
      'artifacts',
    ]),
    'payload fields',
  );
  requireValue(
    value.schemaVersion === 1 &&
      value.product === 'kerfdesk-desktop' &&
      value.kind === 'update-manifest' &&
      value.channel === 'stable',
    'payload identity',
  );
  const names = commercialArtifactNames(value.version);
  requireValue(
    typeof value.sourceSha === 'string' &&
      /^[a-f0-9]{40}$/u.test(value.sourceSha) &&
      value.sourceRef === `refs/tags/v${value.version}`,
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
  requireValue(Array.isArray(value.artifacts) && value.artifacts.length === 3, 'artifact count');
  const seen = new Set();
  for (const artifact of value.artifacts) {
    requireValue(
      exactKeys(artifact, ['name', 'bytes', 'sha256', 'sha512']) &&
        names.includes(artifact.name) &&
        !seen.has(artifact.name),
      'artifact identity',
    );
    seen.add(artifact.name);
    requireValue(
      Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= 300_000_000,
      'artifact size',
    );
    requireValue(
      typeof artifact.sha256 === 'string' &&
        /^[a-f0-9]{64}$/u.test(artifact.sha256) &&
        canonicalSha512(artifact.sha512),
      'artifact digest',
    );
  }
  return value;
}

/**
 * Returns only the entries this page's anchors verify, newest first. An entry it
 * cannot verify (a key rotated after this page shipped, a future entry format, a
 * clock that is behind) is skipped rather than hiding every older release; the
 * signature still decides what is shown. Two verified entries for one version
 * mean the catalogue itself is inconsistent, so nothing is trusted.
 */
export async function verifyCommercialCatalog(text, keySet, now = Date.now()) {
  requireValue(
    typeof text === 'string' && new TextEncoder().encode(text).length <= COMMERCIAL_CATALOG_LIMIT,
    'size',
  );
  const catalog = JSON.parse(text);
  requireValue(
    exactKeys(catalog, ['schemaVersion', 'releases']) &&
      catalog.schemaVersion === 1 &&
      Array.isArray(catalog.releases) &&
      catalog.releases.length <= 64,
    'shape',
  );
  const releases = [];
  const seen = new Set();
  for (const envelope of catalog.releases) {
    let release;
    try {
      release = validateCommercialRelease(
        await verifySignedEnvelope(envelope, keySet, 'stable'),
        now,
      );
    } catch {
      continue;
    }
    requireValue(!seen.has(release.version), 'duplicate version');
    seen.add(release.version);
    releases.push(release);
  }
  // Entries that all fail must not read as "nothing released yet".
  requireValue(catalog.releases.length === 0 || releases.length > 0, 'no verifiable release');
  return releases.sort((a, b) => compareCommercialVersions(b.version, a.version));
}
