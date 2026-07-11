import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

// The 250 "soft" file-size tier from CLAUDE.md's size table and ADR-015 cannot be
// an ESLint warning: ESLint keys rules by name, so a second `max-lines` entry
// REPLACES the error/400 one (last-wins) instead of stacking — you cannot have
// warn/250 AND error/400 on the built-in rule at once (ADR-131). This report-only
// script surfaces the soft tier instead: it lists files over the soft limit and
// ALWAYS exits 0, so it never blocks. Counting mirrors ESLint's `max-lines` with
// skipBlankLines + skipComments — blank and comment-only lines do not count — via
// a line scan that skips string literals (including multi-line templates, whose
// open state is threaded across lines) so a `//` or `/*` inside a string is not
// misread as a comment. It is an approximation of ESLint's AST count — an
// unrecognized regex literal containing `/*` can still fool it — which is
// acceptable for a non-blocking report.

const SOFT_LIMIT = 250;
const checkedRoots = ['src', 'electron', 'scripts', join('audit', 'scripts')];
const checkedRootFiles = [
  'eslint.config.mjs',
  'eslint.electron.config.mjs',
  'vite.config.ts',
  'vitest.config.ts',
];
const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);

// Tests and fixtures are exempt from the file-size limits (eslint.config.mjs
// relaxes them for test scaffolding), so the soft tier — which mirrors the
// hard tier's scope — reports only shipped, non-test files.
function isReportable(path) {
  return !/\.test\.[cm]?[jt]sx?$/.test(path) && !path.includes('__fixtures__');
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name)) && isReportable(path)) {
      yield path;
    }
  }
}

// First index past the unescaped `quote` at or after `from`, or null if the
// quote is left open on this line (a template literal running to the next line).
function closeQuote(line, from, quote) {
  let i = from;
  while (i < line.length) {
    if (line[i] === '\\') {
      i += 2;
      continue;
    }
    if (line[i] === quote) return i + 1;
    i += 1;
  }
  return null;
}

// Does the line carry any code outside comments and strings? Carries BOTH the
// block-comment state and the unterminated-template-literal state to the next
// line (matching ESLint skipComments semantics; only backtick strings span
// lines, so threading their state stops a `/*` inside a multi-line template from
// poisoning the comment scan of every line below it).
function analyzeLine(line, startInBlockComment, startInTemplate) {
  let inBlock = startInBlockComment;
  let hasCode = false;
  let i = 0;
  if (startInTemplate) {
    const end = closeQuote(line, 0, '`'); // resume scanning for the closing backtick
    if (end === null) return { hasCode: true, inBlock, inTemplate: true };
    hasCode = true;
    i = end;
  }
  while (i < line.length) {
    if (inBlock) {
      if (line.slice(i, i + 2) === '*/') {
        inBlock = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '/*') {
      inBlock = true;
      i += 2;
      continue;
    }
    if (two === '//') break; // rest of the line is a line comment
    const ch = line[i];
    if (ch === '"' || ch === "'") {
      hasCode = true;
      const close = closeQuote(line, i + 1, ch);
      i = close === null ? line.length : close; // '/" never span lines
      continue;
    }
    if (ch === '`') {
      hasCode = true;
      const close = closeQuote(line, i + 1, '`');
      if (close === null) return { hasCode, inBlock, inTemplate: true };
      i = close;
      continue;
    }
    if (!/\s/.test(ch)) hasCode = true;
    i += 1;
  }
  return { hasCode, inBlock, inTemplate: false };
}

function countCodeLines(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let count = 0;
  let inBlock = false;
  let inTemplate = false;
  for (const line of normalized.split('\n')) {
    const result = analyzeLine(line, inBlock, inTemplate);
    inBlock = result.inBlock;
    inTemplate = result.inTemplate;
    if (result.hasCode) count += 1;
  }
  return count;
}

function* policyTargets() {
  for (const root of checkedRoots) yield* walk(root);
  for (const file of checkedRootFiles) {
    if (existsSync(file) && sourceExtensions.has(extname(file))) yield file;
  }
}

const oversized = [];
// Report-only: a filesystem error (a locked/unreadable file on Windows, a walk
// permission fault, an fs race) must never fail release:check, where this is
// &&-chained. Skip the unreadable file; swallow a walk-level fault entirely.
try {
  for (const path of policyTargets()) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const lines = countCodeLines(text);
    if (lines > SOFT_LIMIT) {
      oversized.push({ path: relative(process.cwd(), path), lines });
    }
  }
} catch {
  console.log('(soft line-limit scan interrupted; continuing — report-only)');
}
oversized.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));

const header =
  oversized.length > 0
    ? `${oversized.length} file(s) over the ${SOFT_LIMIT} counted-line soft limit (report-only, ADR-015/ADR-131):`
    : `All files are within the ${SOFT_LIMIT} counted-line soft limit.`;
console.log(header);
for (const { path, lines } of oversized) {
  console.log(`  ${String(lines).padStart(4)}  ${path}`);
}

// Mirror the report into the GitHub Actions job summary when running in CI. A
// write failure must never fail the build (this check is report-only), so it is
// swallowed.
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    const rows = oversized.map(({ path, lines }) => `| ${lines} | \`${path}\` |`).join('\n');
    const body =
      oversized.length > 0
        ? `### Soft line-limit report (${SOFT_LIMIT}, non-blocking)\n\n| Counted lines | File |\n| ---: | --- |\n${rows}\n`
        : `### Soft line-limit report\n\n${header}\n`;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  } catch {
    console.log('(could not write the job summary; continuing — report-only)');
  }
}

// Report-only: the soft tier never fails the build (the ESLint error/400 rule is
// the blocking gate).
process.exit(0);
