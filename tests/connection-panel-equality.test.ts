/**
 * T1-144: regression test for the pure structural-equality
 * comparators (`samePreflightSummary`, `sameMessages`) extracted
 * from ConnectionPanelMain.
 *
 * Run: npx tsx tests/connection-panel-equality.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PreflightSummary } from '../src/core/preflight/Preflight';
import {
  samePreflightSummary,
  sameMessages,
} from '../src/ui/components/connection/connectionPanelEquality';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function summary(overrides: Partial<PreflightSummary> = {}): PreflightSummary {
  return {
    score: 90,
    canStart: true,
    blockers: 0,
    warnings: 1,
    issues: [],
    ...overrides,
  } as PreflightSummary;
}

console.log('\n=== T1-144 connection-panel equality ===\n');

// -------- samePreflightSummary --------
{
  // Equal cases
  assert(samePreflightSummary(summary(), summary()),
    'identical summaries → true');
  // Different score
  assert(!samePreflightSummary(summary(), summary({ score: 80 })),
    'score difference → false');
  // Different canStart
  assert(!samePreflightSummary(summary(), summary({ canStart: false })),
    'canStart difference → false');
  // Different blockers
  assert(!samePreflightSummary(summary(), summary({ blockers: 1 })),
    'blockers difference → false');
  // Different warnings
  assert(!samePreflightSummary(summary(), summary({ warnings: 0 })),
    'warnings difference → false');
  // Different ticket
  assert(!samePreflightSummary(
    summary({ validatedTicket: { ticketId: 'a' } as never }),
    summary({ validatedTicket: { ticketId: 'b' } as never }),
  ), 'ticketId difference → false');
  // Same ticket
  assert(samePreflightSummary(
    summary({ validatedTicket: { ticketId: 'x' } as never }),
    summary({ validatedTicket: { ticketId: 'x' } as never }),
  ), 'same ticketId → true');
  // Undefined vs ticket
  assert(!samePreflightSummary(
    summary({ validatedTicket: undefined }),
    summary({ validatedTicket: { ticketId: 'x' } as never }),
  ), 'undefined ticket vs present ticket → false');

  // Different issue count
  const a1 = summary({ issues: [{ id: 'x' } as never] });
  const a2 = summary({ issues: [] });
  assert(!samePreflightSummary(a1, a2), 'different issue count → false');

  // Same issues
  const sameIssue = { id: 'x', severity: 'warn', category: 'bounds', title: 't', detail: 'd', fix: 'f' };
  assert(samePreflightSummary(
    summary({ issues: [sameIssue as never] }),
    summary({ issues: [{ ...sameIssue } as never] }),
  ), 'structurally same issues → true');

  // Different issue field
  assert(!samePreflightSummary(
    summary({ issues: [{ ...sameIssue, id: 'a' } as never] }),
    summary({ issues: [{ ...sameIssue, id: 'b' } as never] }),
  ), 'different issue.id → false');
  assert(!samePreflightSummary(
    summary({ issues: [{ ...sameIssue, severity: 'block' } as never] }),
    summary({ issues: [{ ...sameIssue, severity: 'warn' } as never] }),
  ), 'different issue.severity → false');
  assert(!samePreflightSummary(
    summary({ issues: [{ ...sameIssue, title: 't1' } as never] }),
    summary({ issues: [{ ...sameIssue, title: 't2' } as never] }),
  ), 'different issue.title → false');

  // Order matters
  const i1 = { ...sameIssue, id: '1' };
  const i2 = { ...sameIssue, id: '2' };
  assert(!samePreflightSummary(
    summary({ issues: [i1 as never, i2 as never] }),
    summary({ issues: [i2 as never, i1 as never] }),
  ), 'issue order matters → reverse-order returns false');
}

// -------- sameMessages --------
{
  assert(sameMessages([], []), '[] vs [] → true');
  const same = ['a', 'b', 'c'];
  assert(sameMessages(same, same), 'same reference → true (fast path)');
  assert(sameMessages(['a', 'b'], ['a', 'b']), 'structurally same → true');
  assert(!sameMessages(['a', 'b'], ['a', 'c']), 'one element differs → false');
  assert(!sameMessages(['a', 'b'], ['a']), 'different length → false');
  assert(!sameMessages([], ['a']), 'empty vs non-empty → false');
  // Order matters
  assert(!sameMessages(['a', 'b'], ['b', 'a']), 'order matters → reverse returns false');
}

// -------- Source-level pin: ConnectionPanelMain delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const panelSrc = readFileSync(
    resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(/from '\.\/connection\/connectionPanelEquality'/.test(panelSrc),
    'ConnectionPanelMain imports from connection/connectionPanelEquality');
  assert(/T1-144/.test(panelSrc),
    'ConnectionPanelMain carries T1-144 marker');
  assert(!/^function samePreflightSummary/m.test(panelSrc),
    'inline samePreflightSummary is gone from ConnectionPanelMain');
  assert(!/^function sameMessages/m.test(panelSrc),
    'inline sameMessages is gone from ConnectionPanelMain');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/connection/connectionPanelEquality.ts'),
    'utf-8',
  );
  assert(/T1-144/.test(helperSrc),
    'connectionPanelEquality carries T1-144 marker');
  assert(/export function samePreflightSummary/.test(helperSrc),
    'samePreflightSummary is exported');
  assert(/export function sameMessages/.test(helperSrc),
    'sameMessages is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
