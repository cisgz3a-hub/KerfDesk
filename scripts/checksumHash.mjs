/**
 * T2-103-followup: SHA256 hashing primitive for release artifacts.
 *
 * Lives outside `src/` because the renderer-sandbox contract from
 * T1-89 (pinned by tests/electron-renderer-sandbox.test.ts) bans
 * static `node:*` imports in `src/`. The 4 pure format helpers
 * (`formatChecksumLine` / `formatChecksumsFile` / `parseChecksumsFile`
 * / `matchesAnyPattern`) stay in `src/integrity/checksumFormat.ts`
 * because they are pure string manipulation; only the hashing
 * primitive needs `node:crypto`, so it lives here, in build-script
 * scope, where renderer code never runs.
 */
import { createHash } from 'node:crypto';

/**
 * Compute the lowercase hex SHA256 of a buffer or string. Strings
 * are encoded as UTF-8 before hashing (so the hash matches what
 * `sha256sum` produces on a file containing the same bytes).
 *
 * @param {Buffer | Uint8Array | string} data
 * @returns {string}
 */
export function computeSha256Hex(data) {
  const h = createHash('sha256');
  if (typeof data === 'string') {
    h.update(data, 'utf-8');
  } else {
    h.update(data);
  }
  return h.digest('hex');
}
