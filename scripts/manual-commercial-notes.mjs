import { createPrivateKey, sign } from 'node:crypto';
import {
  updateNotesUrl,
  validateUpdateHighlights,
  validateUpdateNotes,
  verifyUpdateNotes,
} from '../public/desktop-update-notes.mjs';
import { CommercialReleaseError } from './commercial-release-error.mjs';

export function validateReviewedNotes(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'highlights,schemaVersion,sinceSourceSha' ||
    value.schemaVersion !== 1 ||
    (value.sinceSourceSha !== null &&
      (typeof value.sinceSourceSha !== 'string' || !/^[a-f0-9]{40}$/u.test(value.sinceSourceSha)))
  )
    throw new CommercialReleaseError(
      'Reviewed desktop notes require schema, previous source and highlights.',
    );
  validateUpdateHighlights(value.highlights);
  return value;
}

export function requireNotesBaseline(reviewedNotes, previous) {
  validateReviewedNotes(reviewedNotes);
  if (reviewedNotes.sinceSourceSha !== (previous?.sourceSha ?? null))
    throw new CommercialReleaseError(
      'Reviewed notes must name the authenticated previous release source.',
    );
}

/** Separately allowlisted sibling; never add it to the installer artifact names. */
export function updateNotesStorageKey(version) {
  return new URL(updateNotesUrl(version)).pathname.slice(1);
}

export async function signUpdateNotes(release, reviewedNotes, privateKeyPem, keyId, keySet) {
  const { highlights } = validateReviewedNotes(reviewedNotes);
  const payload = validateUpdateNotes(
    {
      schemaVersion: 1,
      product: 'kerfdesk-desktop',
      kind: 'update-notes',
      channel: 'stable',
      version: release.version,
      sourceSha: release.sourceSha,
      publishedAt: release.publishedAt,
      highlights,
    },
    release,
  );
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519')
    throw new CommercialReleaseError('Desktop notes require an Ed25519 signing key.');
  const bytes = Buffer.from(JSON.stringify(payload));
  const envelope = {
    schemaVersion: 1,
    keyId,
    algorithm: 'Ed25519',
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, key).toString('base64'),
  };
  await verifyUpdateNotes(JSON.stringify(envelope), keySet, release);
  return Buffer.from(`${JSON.stringify(envelope)}\n`);
}
