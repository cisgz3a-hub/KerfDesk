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

import { readFileSync } from 'node:fs';

const DECISIONS_FILE = 'DECISIONS.md';
// Captures the number and whatever follows it on the heading line. The suffix
// matters: headings in this file use an ASCII hyphen OR an em dash after the
// number, so anchoring on a separator would silently skip whole sections.
const HEADING_PATTERN = /^## ADR-(\d+)(.*)$/;
const AMENDMENT_PATTERN = /^\s+Amendment\b/;

const source = readFileSync(DECISIONS_FILE, 'utf8');
const lines = source.split('\n');

/** @type {Map<number, number[]>} decision number -> 1-indexed heading lines */
const decisionLines = new Map();
let amendmentCount = 0;

lines.forEach((line, index) => {
  const match = HEADING_PATTERN.exec(line);
  if (match === null) return;
  const number = Number(match[1]);
  if (AMENDMENT_PATTERN.test(match[2] ?? '')) {
    amendmentCount += 1;
    return;
  }
  const seen = decisionLines.get(number) ?? [];
  seen.push(index + 1);
  decisionLines.set(number, seen);
});

const duplicates = [...decisionLines.entries()]
  .filter(([, at]) => at.length > 1)
  .sort(([a], [b]) => a - b);

if (duplicates.length > 0) {
  console.error(`Duplicate ADR numbers in ${DECISIONS_FILE}:`);
  for (const [number, at] of duplicates) {
    console.error(`  ADR-${number} claimed ${at.length}x`);
    for (const line of at) {
      console.error(`    ${DECISIONS_FILE}:${line}  ${lines[line - 1]?.trim() ?? ''}`);
    }
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
  }), all numbers unique. Next free number: ADR-${nextFree}.`,
);
