import { readFileSync } from 'node:fs';

const DECISIONS_PATH = 'DECISIONS.md';

// A decision heading is `## ADR-<n> - Title` (hyphen or em dash). An
// `## ADR-<n> Amendment - ...` heading deliberately REUSES its number to amend an
// existing decision (ADR-211 Amendment), so it is not a duplicate and is excluded
// by requiring a dash immediately after the number.
const DECISION_HEADING = /^## ADR-(\d+)\s+[-—]/;

const firstSeenLine = new Map();
const duplicates = [];

readFileSync(DECISIONS_PATH, 'utf8')
  .split('\n')
  .forEach((line, index) => {
    const match = DECISION_HEADING.exec(line);
    if (match === null) return;
    const number = match[1];
    const priorLine = firstSeenLine.get(number);
    if (priorLine === undefined) {
      firstSeenLine.set(number, index + 1);
      return;
    }
    duplicates.push(`ADR-${number} reused at line ${index + 1} (first used at line ${priorLine})`);
  });

if (duplicates.length > 0) {
  console.error(`Duplicate ADR numbers in ${DECISIONS_PATH}:`);
  for (const entry of duplicates) {
    console.error(entry);
  }
  console.error(
    'Parallel PRs race for the next number. Renumber to the next free ADR and update every reference to it.',
  );
  process.exit(1);
}

console.log(
  `ADR numbering check passed: ${firstSeenLine.size} unique decisions in ${DECISIONS_PATH}.`,
);
