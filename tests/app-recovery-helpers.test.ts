import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildUnsafePriorStateAlert,
  formatUnsafePriorStateStartedAt,
} from '../src/ui/components/app/appRecoveryHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

console.log('\n=== T2-6 Phase 3av app recovery helpers ===\n');

{
  const alert = buildUnsafePriorStateAlert(
    { kind: 'job-running', startedAt: 12345, ticketId: 'ticket-123' },
    () => 'May 16, 2026, 10:30 AM',
  );
  assert(alert.title === 'Previous session ended unexpectedly', 'unsafe-prior-state alert title is stable');
  assert(alert.body.includes('A job was running when the previous session ended.'), 'alert explains prior running job');
  assert(alert.body.includes('machine state may be unsafe'), 'alert names unsafe machine state');
  assert(alert.body.includes('Inspect the machine and the workpiece BEFORE reconnecting.'), 'alert preserves inspection warning');
  assert(alert.body.includes('Job started: May 16, 2026, 10:30 AM'), 'alert includes formatted start time');
  assert(alert.body.includes('Ticket: ticket-123'), 'alert includes ticket id when present');
}

{
  const alert = buildUnsafePriorStateAlert(
    { kind: 'job-running', startedAt: 67890, ticketId: null },
    () => 'May 16, 2026, 11:00 AM',
  );
  assert(alert.body.includes('Job started: May 16, 2026, 11:00 AM'), 'alert includes start time without ticket');
  assert(!alert.body.includes('Ticket:'), 'alert omits ticket line when absent');
}

{
  const formatted = formatUnsafePriorStateStartedAt(0);
  assert(typeof formatted === 'string' && formatted.length > 0, 'default unsafe-prior-state date formatter returns a label');
}

const root = process.cwd();
const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appRecoveryHelpers.ts'), 'utf8');
const roadmapSource = readFileSync(resolve(root, 'docs/ROADMAP.md'), 'utf8');
const auditSource = readFileSync(resolve(root, 'docs/ROADMAP-shipped-audit.md'), 'utf8');
const handoffSource = readFileSync(resolve(root, 'docs/AGENT_HANDOFF.md'), 'utf8');

assert(
  appSource.includes("from './app/appRecoveryHelpers'"),
  'App imports from ./app/appRecoveryHelpers',
);
assert(
  appSource.includes('buildUnsafePriorStateAlert(unsafe)'),
  'App delegates unsafe-prior-state alert text to buildUnsafePriorStateAlert',
);
assert(
  !appSource.includes('const startedLabel = (() =>'),
  'App no longer formats unsafe-prior-state startedAt inline',
);
assert(
  helperSource.includes('T2-6 Phase 3av'),
  'appRecoveryHelpers carries the T2-6 Phase 3av marker',
);
for (const [label, source] of [
  ['ROADMAP.md', roadmapSource],
  ['ROADMAP-shipped-audit.md', auditSource],
  ['AGENT_HANDOFF.md', handoffSource],
] as const) {
  assert(source.includes('T2-6 Phase 3av'), `${label} records the Phase 3av close-out`);
  assert(source.includes('appRecoveryHelpers'), `${label} names the extracted recovery helper`);
}

console.log('Unsafe-prior-state recovery alert text is extracted from App.');
