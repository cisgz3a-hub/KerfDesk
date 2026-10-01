import {
  UPDATE_NOTES_LIMIT,
  updateNotesUrl,
  verifyUpdateNotes,
} from '../public/desktop-update-notes.mjs';
import { readBoundedManifest } from '../public/desktop-release-manifest.mjs';
import {
  manualReleaseKeySet,
  type ManualCandidate,
  type UpdateFetch,
} from './manual-update-manifest.js';
import type { PublicKeys } from './licensing-verification.js';

/** Notes are optional presentation metadata, never update authority. */
export async function fetchManualUpdateNotes(
  fetch: UpdateFetch,
  keys: PublicKeys,
  candidate: ManualCandidate,
  now: number,
): Promise<readonly string[] | null> {
  try {
    const url = updateNotesUrl(candidate.release.version);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (response.redirected || (response.url !== '' && response.url !== url)) return null;
    const text = await readBoundedManifest(response, UPDATE_NOTES_LIMIT);
    const notes = await verifyUpdateNotes(text, manualReleaseKeySet(keys), candidate.release, now);
    return notes.highlights;
  } catch {
    // Older releases have no sidecar; an outage must not prevent a verified update.
    return null;
  }
}
