/**
 * T1-61: start-mode buttons in Workflow.tsx must show clear sentences,
 * not single-word emoji labels, and carry tooltips with when-to-use
 * guidance. The selected mode's long-form description must render below
 * the button row. Source-level pin so a future label rewrite cannot
 * silently regress to single-word labels.
 *
 * Run: npx tsx tests/start-mode-labels.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(here, '../src/ui/components/connection/Workflow.tsx');
const workflowSrc = readFileSync(workflowPath, 'utf-8');

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T1-61 start-mode-labels ===\n');

// The new shape: each entry has short + long + tooltip.
assert(
  /short:\s*'Use canvas position'/.test(workflowSrc),
  "absolute mode short label is 'Use canvas position'",
);
assert(
  /short:\s*'Start from laser head'/.test(workflowSrc),
  "current mode short label is 'Start from laser head'",
);
assert(
  /short:\s*'Use saved zero point'/.test(workflowSrc),
  "savedOrigin mode short label is 'Use saved zero point'",
);

// Long-form descriptions exist for each mode (sentence-shaped: contain
// at least one verb-like phrase).
assert(
  /long:\s*'Burn where the design sits on the bed grid\.'/.test(workflowSrc),
  'absolute mode has long-form description',
);
assert(
  /long:\s*'Jog the laser to the start corner, then run from there\.'/.test(workflowSrc),
  'current mode has long-form description',
);
assert(
  /long:\s*'Use a marked fixture point for repeat jobs\.'/.test(workflowSrc),
  'savedOrigin mode has long-form description',
);

// Tooltips exist for each mode and carry the audit's "best for" framing.
assert(
  /tooltip:\s*'Best for: repeatable bed-grid jobs after homing/.test(workflowSrc),
  'absolute mode tooltip carries when-to-use guidance',
);
assert(
  /tooltip:\s*'Best for: one-off jobs on placed material/.test(workflowSrc),
  'current mode tooltip carries when-to-use guidance',
);
assert(
  /tooltip:\s*'Best for: fixtures and repeat jobs/.test(workflowSrc),
  'savedOrigin mode tooltip carries when-to-use guidance',
);

// Buttons render the short label and surface the tooltip via `title`.
assert(
  /title:\s*m\.tooltip/.test(workflowSrc),
  'mode buttons surface m.tooltip via the title attribute (HTML-native hover hint)',
);
// The button content uses the short label, not the legacy emoji label.
assert(
  /\}\s*,\s*m\.short\s*\)/.test(workflowSrc),
  'mode buttons render m.short as the visible label',
);

// Selected mode's long-form description renders below the button row.
assert(
  /selectedMode\s*&&\s*React\.createElement/.test(workflowSrc),
  'long-form description renders only when a mode is selected',
);
assert(
  /selectedMode\.long/.test(workflowSrc),
  "selected mode's long-form description is rendered into the panel",
);

assert(
  /\}, 'Job Position'\)/.test(workflowSrc),
  "workflow section heading is 'Job Position'",
);

// Legacy emoji-only labels are gone.
assert(
  !/'📍 Bed'/.test(workflowSrc),
  "legacy '📍 Bed' label removed",
);
assert(
  !/'🎯 Head'/.test(workflowSrc),
  "legacy '🎯 Head' label removed",
);
assert(
  !/'⚑ Origin'/.test(workflowSrc),
  "legacy '⚑ Origin' label removed",
);

// T1-61 marker preserved for grep.
assert(
  /T1-61/.test(workflowSrc),
  'T1-61 marker present in Workflow.tsx for grep discoverability',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
