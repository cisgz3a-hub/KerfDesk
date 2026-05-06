/**
 * T2-103: SHA256 checksum format helpers for release artifacts.
 * Audit 5B Critical 6 + Required Priority 9 calls for verifiable
 * artifacts so users can check `sha256sum -c SHA256SUMS` against a
 * downloaded installer.
 *
 * The format is the standard `sha256sum` output:
 *   `<64-char-lowercase-hex>  <filename>`
 * — two spaces between hash and filename. Lines are sorted
 * alphabetically by filename so a release-to-release diff of
 * `SHA256SUMS` is reviewable.
 *
 * The pure helpers live in `src/integrity/` so tests can verify the
 * format without spawning a subprocess; the orchestrating script is
 * `scripts/generate-checksums.mjs`. Path note: avoiding `src/release/`
 * because the repo's top-level `.gitignore` excludes any `release/`
 * directory (the build output dir).
 *
 * **T2-103-followup (2026-05-06):** the hashing primitive
 * `computeSha256Hex` (the only export here that needed
 * `node:crypto`) was moved to `scripts/checksumHash.mjs` to satisfy
 * the renderer-sandbox contract from T1-89 — `src/` must not
 * statically import `node:*` modules (the renderer can load
 * anything under `src/`, and `node:crypto` is unavailable there).
 * The 4 pure string-manipulation helpers below have no Node
 * dependency and are renderer-safe.
 */

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Format one line of a SHA256SUMS file. Validates that `hashHex` is
 * exactly 64 lowercase hex chars (the only shape `sha256sum -c`
 * accepts) and that `filename` does not contain a newline (which
 * would corrupt subsequent lines).
 */
export function formatChecksumLine(hashHex: string, filename: string): string {
  if (!HEX64.test(hashHex)) {
    throw new Error(`Invalid SHA256 hex: '${hashHex}' (expected 64 lowercase hex chars)`);
  }
  if (filename.length === 0) throw new Error('filename must not be empty');
  if (/[\r\n]/.test(filename)) {
    throw new Error('filename must not contain newline characters');
  }
  // Two spaces between hash and filename — sha256sum's binary-mode
  // separator is `  *` (hash, space, asterisk, name); `  ` (two
  // spaces) is text mode. Use text mode for cross-platform safety.
  return `${hashHex}  ${filename}`;
}

/**
 * Concatenate lines into a SHA256SUMS file body. Sorts
 * alphabetically by filename (the second whitespace-separated field)
 * so output is stable across runs.
 */
export function formatChecksumsFile(lines: string[]): string {
  const sorted = [...lines].sort((a, b) => {
    const fa = a.split(/\s+/, 2)[1] ?? '';
    const fb = b.split(/\s+/, 2)[1] ?? '';
    return fa.localeCompare(fb);
  });
  return sorted.join('\n') + '\n';
}

/**
 * Parse a SHA256SUMS file back into structured entries — useful for
 * a verification script or release-diff tool. Tolerates blank lines
 * and ignores them.
 */
export interface ChecksumEntry {
  hash: string;
  filename: string;
}

export function parseChecksumsFile(text: string): ChecksumEntry[] {
  const out: ChecksumEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([0-9a-f]{64})\s{1,}\*?(.+)$/);
    if (!m) continue;
    out.push({ hash: m[1], filename: m[2].trim() });
  }
  return out;
}

/**
 * Glob matcher used by the script. Supports just `*` as wildcard
 * (sufficient for our patterns: `*.exe`, `*.dmg`, etc) — no need to
 * pull in a globbing library.
 */
export function matchesAnyPattern(name: string, patterns: ReadonlyArray<string>): boolean {
  for (const p of patterns) {
    const re = new RegExp(
      '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    if (re.test(name)) return true;
  }
  return false;
}
