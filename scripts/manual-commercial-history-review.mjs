import { MANUAL_CATALOG_RELEASE_LIMIT } from '../public/desktop-manual-catalog.mjs';
import { CommercialReleaseError, digest } from './commercial-release-manifest.mjs';

const fields = (value, names) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === names.sort().join(',');

/** Operator-reviewed receipts supply legacy promotion evidence absent from uploaded objects. */
export function reviewedManualHistory(review, latest) {
  const refuse = (reason) => {
    throw new CommercialReleaseError(
      `Invalid reviewed history: ${reason}. Supply --reviewed-history <file>; see scripts/manual-commercial-release-README.md.`,
    );
  };
  if (
    !fields(review, ['schemaVersion', 'expectedLatestSha256', 'entries']) ||
    review.schemaVersion !== 1 ||
    review.expectedLatestSha256 !== digest(latest) ||
    !Array.isArray(review.entries) ||
    review.entries.length === 0 ||
    review.entries.length > MANUAL_CATALOG_RELEASE_LIMIT
  )
    refuse('migration requires a complete evidence file pinned to the exact latest SHA-256');
  const entries = new Map();
  for (const entry of review.entries) {
    if (
      !fields(entry, ['version', 'manifestSha256', 'status', 'evidence']) ||
      typeof entry.version !== 'string' ||
      !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(entry.version) ||
      !/^[a-f0-9]{64}$/u.test(entry.manifestSha256 ?? '') ||
      !['published', 'abandoned'].includes(entry.status) ||
      typeof entry.evidence !== 'string' ||
      entry.evidence.trim().length === 0 ||
      entry.evidence.length > 2048 ||
      entries.has(entry.version)
    )
      refuse(
        'each archived version needs one digest, disposition and publication receipt reference',
      );
    entries.set(entry.version, entry);
  }
  return entries;
}
