// ADR number-uniqueness gate.
//
// On 2026-07-25 THREE decisions landed on main numbered ADR-257, and two more
// branches were independently mid-fix without knowing about each other. Every
// agent had "checked" the number — against a main that moved while their CI
// ran. Numbering is therefore not something review can hold: two correct
// reviews of two correct branches still produce a collision at merge.
//
// This is the mechanical answer. It also prints the next free number, so the
// cheapest way to pick one is to run this rather than to grep and guess.
//
// Amendments deliberately re-use their decision's number
// (`## ADR-211 Amendment - ...`) and are not collisions.
//
// TWO SOURCES (ADR-344). Decisions up to ADR-343 live in the historical
// `DECISIONS.md`; every decision written after it is its own file under
// `docs/decisions/`. Appending to one shared file made a textual merge
// conflict the NORMAL outcome of two branches landing decisions the same day —
// git cannot merge two different additions at the same end-of-file position.
// Separate files have no shared position to conflict over. The gate reads both
// so numbering stays global across the split.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LEGACY_FILE = 'DECISIONS.md';
const DECISION_DIR = join('docs', 'decisions');
// Captures the number and whatever follows it on the heading line. The suffix
// matters: headings in this file use an ASCII hyphen OR an em dash after the
// number, so anchoring on a separator would silently skip whole sections.
const HEADING_PATTERN = /^## ADR-(\d+)(.*)$/;
const AMENDMENT_PATTERN = /^\s+Amendment\b/;
// `ADR-344-slug.md`, or `ADR-311-amendment-1-slug.md` for an amendment file.
const FILENAME_PATTERN = /^ADR-(\d+)(?:-amendment-\d+)?-[a-z0-9-]+\.md$/u;

/** @type {Map<number, {file: string, line: number}[]>} */
const decisionLines = new Map();
let amendmentCount = 0;

function readLines(path) {
  // Split on either ending: `text=auto eol=lf` stores LF but checks out CRLF on
  // Windows, and a trailing `\r` defeats the `$` anchor above, which made the
  // gate silently report zero decisions instead of parsing them.
  return readFileSync(path, 'utf8').split(/\r?\n/);
}

function collectHeadings(path, label, onNumber) {
  readLines(path).forEach((line, index) => {
    const match = HEADING_PATTERN.exec(line);
    if (match === null) return;
    const number = Number(match[1]);
    if (AMENDMENT_PATTERN.test(match[2] ?? '')) {
      amendmentCount += 1;
      onNumber?.(number, index + 1, true);
      return;
    }
    const seen = decisionLines.get(number) ?? [];
    seen.push({ file: label, line: index + 1 });
    decisionLines.set(number, seen);
    onNumber?.(number, index + 1, false);
  });
}

function decisionFiles() {
  let names;
  try {
    names = readdirSync(DECISION_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.md') && statSync(join(DECISION_DIR, name)).isFile())
    .sort();
}

const misnamed = [];
collectHeadings(LEGACY_FILE, LEGACY_FILE);
for (const name of decisionFiles()) {
  const claimed = FILENAME_PATTERN.exec(name);
  if (claimed === null) {
    misnamed.push(
      `  ${join(DECISION_DIR, name)}  (expected ADR-<number>[-amendment-<n>]-<slug>.md)`,
    );
    continue;
  }
  const expected = Number(claimed[1]);
  collectHeadings(join(DECISION_DIR, name), join(DECISION_DIR, name), (number, line) => {
    if (number === expected) return;
    misnamed.push(
      `  ${join(DECISION_DIR, name)}:${line}  heading says ADR-${number}, filename says ADR-${expected}`,
    );
  });
}

if (misnamed.length > 0) {
  console.error(`Decision files under ${DECISION_DIR} must be named for the ADR they hold:`);
  for (const problem of misnamed) console.error(problem);
  console.error('\nOne decision per file is what keeps two branches from conflicting.');
  process.exit(1);
}

const duplicates = [...decisionLines.entries()]
  .filter(([, at]) => at.length > 1)
  .sort(([a], [b]) => a - b);

if (duplicates.length > 0) {
  console.error('Duplicate ADR numbers:');
  for (const [number, at] of duplicates) {
    console.error(`  ADR-${number} claimed ${at.length}x`);
    for (const { file, line } of at) console.error(`    ${file}:${line}`);
  }
  console.error('\nThe earliest-landed decision keeps the number; renumber the others and');
  console.error('update their references. Beware: references to a shared number belong to');
  console.error('DIFFERENT decisions, so a blanket find-and-replace mis-attributes them.');
  process.exit(1);
}

const highest = Math.max(...decisionLines.keys());
let nextFree = highest + 1;
while (decisionLines.has(nextFree)) nextFree += 1;

console.log(
  `ADR number gate passed: ${decisionLines.size} decisions (+${amendmentCount} amendment${
    amendmentCount === 1 ? '' : 's'
  }) across ${LEGACY_FILE} and ${DECISION_DIR}/, all numbers unique. Next free number: ADR-${nextFree}.`,
);
