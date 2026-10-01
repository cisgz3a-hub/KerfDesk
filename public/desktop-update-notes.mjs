/* global TextEncoder */
import { verifySignedEnvelope } from './desktop-release-manifest.mjs';
import { COMMERCIAL_ORIGIN, commercialArtifactNames } from './desktop-commercial-catalog.mjs';
import { MANUAL_DOWNLOAD_PREFIX } from './desktop-manual-download.mjs';

export const UPDATE_NOTES_LIMIT = 16_384;
const exact = (value, fields) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...fields].sort().join(',');
function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid desktop update notes: ${message}`);
}

/** A separate sidecar path; it is never an allowed executable download. */
export function updateNotesUrl(version) {
  commercialArtifactNames(version);
  return `${COMMERCIAL_ORIGIN}/${MANUAL_DOWNLOAD_PREFIX}/releases/${version}/release-notes.json`;
}

export function validateUpdateHighlights(highlights) {
  requireValue(
    Array.isArray(highlights) &&
      highlights.length >= 1 &&
      highlights.length <= 6 &&
      new Set(highlights).size === highlights.length &&
      highlights.every(
        (line) =>
          typeof line === 'string' &&
          line.length > 0 &&
          line.trim() === line &&
          Array.from(line).length <= 240 &&
          !Array.from(line).some((character) => character.charCodeAt(0) < 32) &&
          !/[<>\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(line),
      ),
    'highlights must be one to six distinct short plain lines',
  );
  return highlights;
}

export function validateUpdateNotes(value, release, now = Date.now()) {
  requireValue(
    exact(value, [
      'schemaVersion',
      'product',
      'kind',
      'channel',
      'version',
      'sourceSha',
      'publishedAt',
      'highlights',
    ]),
    'payload fields',
  );
  requireValue(
    value.schemaVersion === 1 &&
      value.product === 'kerfdesk-desktop' &&
      value.kind === 'update-notes' &&
      value.channel === 'stable',
    'payload identity',
  );
  commercialArtifactNames(value.version);
  const time = typeof value.publishedAt === 'string' ? Date.parse(value.publishedAt) : NaN;
  requireValue(
    typeof value.sourceSha === 'string' &&
      /^[a-f0-9]{40}$/u.test(value.sourceSha) &&
      Number.isFinite(time) &&
      time > 0 &&
      new Date(time).toISOString() === value.publishedAt &&
      time <= now + 300_000,
    'source or publication time',
  );
  requireValue(
    release !== null &&
      typeof release === 'object' &&
      value.version === release.version &&
      value.sourceSha === release.sourceSha &&
      value.publishedAt === release.publishedAt,
    'release mismatch',
  );
  validateUpdateHighlights(value.highlights);
  return value;
}

/** Call only with the already authenticated release whose update is displayed. */
export async function verifyUpdateNotes(text, keySet, release, now = Date.now()) {
  requireValue(
    typeof text === 'string' && new TextEncoder().encode(text).length <= UPDATE_NOTES_LIMIT,
    'size',
  );
  return validateUpdateNotes(
    await verifySignedEnvelope(JSON.parse(text), keySet, 'stable'),
    release,
    now,
  );
}
