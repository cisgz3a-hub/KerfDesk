/**
 * Audit Phase 9 sub-pass 1 — line-number-drift detector.
 *
 * Worked example for `docs/AUDIT.md` Phase 9. Scans a directory tree
 * for inline comments containing `<file>:<line>` citations, reads
 * the cited file at the cited line, and reports each citation as
 * either:
 *
 *   - `match`:   the cited line was reachable and is non-empty.
 *   - `dangling`: the cited file does not exist.
 *   - `out_of_range`: the file is shorter than the cited line.
 *   - `empty_line`: the cited line is blank (the comment likely
 *     refers to whitespace, suggesting the surrounding code has
 *     shifted upward).
 *
 * The script is intentionally narrow — it does NOT decide whether
 * the cited line *semantically matches* the surrounding comment.
 * That's the auditor's job. The script's job is to surface
 * citations that are objectively broken (file missing, line past
 * EOF, line empty) so the auditor can investigate.
 *
 * This is a single sub-pass implemented end-to-end so the audit
 * prompt is verified runnable, not theoretical. Future audit work
 * may grow sibling scripts (one per Phase 9 sub-pass) under
 * `scripts/audit-*.mjs`.
 *
 * Usage:
 *   node scripts/audit-drift-sample.mjs [--root <dir>] [--json] [--quiet]
 *
 * Defaults to `--root src/`. With `--json`, emits a single JSON
 * document to stdout. Without `--json`, emits a human-readable
 * summary plus per-issue lines.
 *
 * Exit codes:
 *   0 — no drift detected.
 *   1 — drift detected (one or more citations failed). Non-zero
 *       lets CI / a future audit pipeline gate on this.
 *   2 — usage error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// ---- CLI parsing -------------------------------------------------

const argv = process.argv.slice(2);
let rootRel = 'src';
let asJson = false;
let quiet = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--root') {
    rootRel = argv[++i] ?? 'src';
  } else if (a === '--json') {
    asJson = true;
  } else if (a === '--quiet') {
    quiet = true;
  } else if (a === '-h' || a === '--help') {
    console.log('Usage: node scripts/audit-drift-sample.mjs [--root <dir>] [--json] [--quiet]');
    process.exit(0);
  } else {
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
}

const rootAbs = path.resolve(repoRoot, rootRel);
if (!fs.existsSync(rootAbs)) {
  console.error(`root does not exist: ${rootAbs}`);
  process.exit(2);
}

// ---- File walk ---------------------------------------------------

/**
 * @param {string} dir
 * @returns {string[]} absolute file paths
 */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      // Limit to text-ish files we expect citations in.
      if (/\.(ts|tsx|mjs|js|md|txt)$/.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

const files = walk(rootAbs);

// ---- Citation extraction -----------------------------------------

/**
 * A citation looks like `src/path/to/file.ts:NNN`. We require:
 *   - a path component containing at least one `/` (rules out
 *     things like `1.5:2` in math comments);
 *   - a known extension;
 *   - `:` followed by a 1–6 digit line number.
 *
 * The pattern is scoped to comment lines (// or /* ... *\/ or
 * markdown text). To keep the regex grounded, we scan every line
 * and accept matches anywhere — the surrounding text isn't part
 * of the verification.
 */
const CITATION = /([a-zA-Z0-9_\-./]+\.(?:ts|tsx|mjs|js|md))[:#]L?(\d{1,6})/g;

/** @type {Array<{
 *   citingFile: string,
 *   citingLine: number,
 *   citedPath: string,
 *   citedLine: number,
 *   status: 'match' | 'dangling' | 'out_of_range' | 'empty_line',
 *   citedContent?: string,
 * }>} */
const findings = [];

const fileCache = new Map();
/**
 * Reads a file's lines once; caches.
 * @param {string} abs
 * @returns {string[] | null}
 */
function readLines(abs) {
  if (fileCache.has(abs)) return fileCache.get(abs);
  if (!fs.existsSync(abs)) {
    fileCache.set(abs, null);
    return null;
  }
  try {
    const lines = fs.readFileSync(abs, 'utf-8').split(/\r?\n/);
    fileCache.set(abs, lines);
    return lines;
  } catch {
    fileCache.set(abs, null);
    return null;
  }
}

let totalCitations = 0;

for (const fileAbs of files) {
  let body;
  try {
    body = fs.readFileSync(fileAbs, 'utf-8');
  } catch {
    continue;
  }
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    CITATION.lastIndex = 0;
    let m;
    while ((m = CITATION.exec(line)) !== null) {
      const citedPathRaw = m[1];
      const citedLine = Number(m[2]);
      if (!citedPathRaw.includes('/')) continue; // e.g. "thing.ts:0" without a dir
      totalCitations++;

      // Resolve cited path. Try relative to the citing file's dir,
      // then relative to repo root. Most citations in this repo are
      // repo-relative (e.g. `src/app/MachineService.ts:123`), so we
      // prefer that.
      let citedAbs = path.resolve(repoRoot, citedPathRaw);
      let citedLines = readLines(citedAbs);
      if (citedLines == null) {
        citedAbs = path.resolve(path.dirname(fileAbs), citedPathRaw);
        citedLines = readLines(citedAbs);
      }

      if (citedLines == null) {
        findings.push({
          citingFile: path.relative(repoRoot, fileAbs).replace(/\\/g, '/'),
          citingLine: i + 1,
          citedPath: citedPathRaw,
          citedLine,
          status: 'dangling',
        });
        continue;
      }

      if (citedLine < 1 || citedLine > citedLines.length) {
        findings.push({
          citingFile: path.relative(repoRoot, fileAbs).replace(/\\/g, '/'),
          citingLine: i + 1,
          citedPath: citedPathRaw,
          citedLine,
          status: 'out_of_range',
          citedContent: `(file has ${citedLines.length} lines)`,
        });
        continue;
      }

      const content = citedLines[citedLine - 1] ?? '';
      const trimmed = content.trim();
      if (trimmed.length === 0) {
        findings.push({
          citingFile: path.relative(repoRoot, fileAbs).replace(/\\/g, '/'),
          citingLine: i + 1,
          citedPath: citedPathRaw,
          citedLine,
          status: 'empty_line',
          citedContent: content,
        });
      } else {
        findings.push({
          citingFile: path.relative(repoRoot, fileAbs).replace(/\\/g, '/'),
          citingLine: i + 1,
          citedPath: citedPathRaw,
          citedLine,
          status: 'match',
          citedContent: trimmed.length > 120 ? trimmed.slice(0, 117) + '...' : trimmed,
        });
      }
    }
  }
}

// ---- Reporting ---------------------------------------------------

const counts = {
  total: findings.length,
  match: findings.filter(f => f.status === 'match').length,
  dangling: findings.filter(f => f.status === 'dangling').length,
  out_of_range: findings.filter(f => f.status === 'out_of_range').length,
  empty_line: findings.filter(f => f.status === 'empty_line').length,
};

const driftCount = counts.dangling + counts.out_of_range + counts.empty_line;

if (asJson) {
  const report = {
    root: rootRel,
    scannedFiles: files.length,
    totalCitations,
    counts,
    drift: findings.filter(f => f.status !== 'match'),
    matches: findings.filter(f => f.status === 'match'),
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else if (!quiet) {
  console.log(`audit-drift-sample (Phase 9 sub-pass 1) — line-number drift`);
  console.log(`  root:           ${rootRel}`);
  console.log(`  scanned files:  ${files.length}`);
  console.log(`  citations:      ${counts.total}`);
  console.log(`  match:          ${counts.match}`);
  console.log(`  dangling:       ${counts.dangling}`);
  console.log(`  out of range:   ${counts.out_of_range}`);
  console.log(`  empty line:     ${counts.empty_line}`);
  console.log('');
  if (driftCount === 0) {
    console.log('No drift detected.');
  } else {
    console.log(`Drift findings (${driftCount}):`);
    for (const f of findings) {
      if (f.status === 'match') continue;
      console.log(`  ${f.status.padEnd(13)} ${f.citingFile}:${f.citingLine}  →  ${f.citedPath}:${f.citedLine}` + (f.citedContent ? `  ${f.citedContent}` : ''));
    }
  }
}

process.exit(driftCount > 0 ? 1 : 0);
