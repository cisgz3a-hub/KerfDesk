/**
 * Roadmap current-count guard.
 *
 * The historical audit tables are intentionally preserved, but the
 * "current checklist snapshot" sections must track the live master
 * checklist so agents do not resume from stale open-ticket counts.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const roadmap = readFileSync('docs/ROADMAP.md', 'utf8');
const audit = readFileSync('docs/ROADMAP-shipped-audit.md', 'utf8');

type Tier = 'T1' | 'T2' | 'T3' | 'T4';

function checklistCount(tier: Tier, mark: 'x' | ' '): number {
  const escaped = mark === 'x' ? 'x' : ' ';
  const pattern = new RegExp(`^- \\[${escaped}\\] ${tier}-`, 'gm');
  return (roadmap.match(pattern) ?? []).length;
}

const expected = {
  T1: { shipped: checklistCount('T1', 'x'), open: checklistCount('T1', ' ') },
  T2: { shipped: checklistCount('T2', 'x'), open: checklistCount('T2', ' ') },
  T3: { shipped: checklistCount('T3', 'x'), open: checklistCount('T3', ' ') },
  T4: { shipped: checklistCount('T4', 'x'), open: checklistCount('T4', ' ') },
} as const;

function assertSnapshotRow(doc: string, tier: Tier): void {
  const { shipped, open } = expected[tier];
  assert.match(
    doc,
    new RegExp(`\\| ${tier} \\| ${shipped} \\| ${open === 1 && tier === 'T4' ? '1 broad line' : open} \\|`),
    `${tier} current snapshot row matches master checklist count`,
  );
}

console.log('\n=== roadmap current checklist counts ===\n');

for (const tier of ['T1', 'T2', 'T3', 'T4'] as const) {
  assertSnapshotRow(roadmap, tier);
  assertSnapshotRow(audit, tier);
}

assert.match(audit, /### Open \(5\)/, 'Tier 3 audit open heading is current');
assert.match(
  audit,
  /T3-4 .*T3-12.*T3-17.*T3-34.*T3-84/s,
  'Tier 3 audit open list names the five live open T3 tickets',
);
for (const stale of ['T3-15', 'T3-24', 'T3-43', 'T3-48', 'T3-55', 'T3-89', 'T3-90', 'T3-91']) {
  const openBlock = audit.slice(audit.indexOf('### Open ('));
  assert(!openBlock.includes(stale), `${stale} no longer appears in the current Tier 3 open block`);
}

console.log('Roadmap current checklist count guard passed.');
