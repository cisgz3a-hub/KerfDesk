/**
 * T1-229: docs backfill for the audit-discovered coupled-triple gap.
 *
 * The code/test commits for T1-209..T1-214 and T1-216..T1-222 already existed,
 * but the canonical roadmap and shipped-audit ledger omitted them.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const roadmap = readFileSync('docs/ROADMAP.md', 'utf8');
const ledger = readFileSync('docs/ROADMAP-shipped-audit.md', 'utf8');

const shippedTickets = [
  ['T1-209', 'ce8078a6'],
  ['T1-210', '3e980ce9'],
  ['T1-211', 'd756907a'],
  ['T1-212', 'c3827ed3'],
  ['T1-213', '622b4372'],
  ['T1-214', '23c433f8'],
  ['T1-216', '1def34cd'],
  ['T1-217', '2c5f9196'],
  ['T1-218', '29b67f53'],
  ['T1-219', 'e1335ba8'],
  ['T1-220', '993aaab3'],
  ['T1-221', 'ac473616'],
  ['T1-222', 'cc17f1b9'],
] as const;

test('ROADMAP has detail and checklist entries for every backfilled shipped ticket', () => {
  for (const [ticket, hash] of shippedTickets) {
    assert.match(roadmap, new RegExp(`### ${ticket} \\\\| `), `${ticket} detail block`);
    assert.match(roadmap, new RegExp(`- \\[x\\] ${ticket} .*${hash}`), `${ticket} checklist hash`);
  }

  assert.match(roadmap, /T1-209-followup.*ab8785d9/, 'T1-209 follow-up hash recorded');
});

test('shipped-audit ledger has a row for every backfilled ticket', () => {
  for (const [ticket, hash] of shippedTickets) {
    assert.match(ledger, new RegExp(`\\| ${ticket} \\|[^\\n]+\\| ${hash} \\|`), `${ticket} ledger row`);
  }
});
