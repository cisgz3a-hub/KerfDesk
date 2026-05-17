/**
 * WorkflowPanel v2 start safety:
 * the feature flag may route to the guided panel, but Start must use
 * real frame-ticket proof rather than minting an unframed override.
 *
 * Run: npx tsx tests/workflow-panel-frame-ticket-start-gate.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../src/ui/components/ConnectionPanel.tsx'), 'utf-8');

console.log('\n=== WorkflowPanel frame-ticket start gate ===\n');

assert(
  /const WORKFLOW_PANEL_V2_ENABLED = true/.test(src),
  'WorkflowPanel routing honors the persisted feature flag again',
);
assert(
  /createFramedStartTicket/.test(src),
  'WorkflowPanel adapter creates framed start tickets after successful frame',
);
assert(
  /validateFrameTicketForStart/.test(src),
  'WorkflowPanel adapter validates frame tickets before enabling Start',
);
assert(
  !/createUnframedStartOverrideTicket/.test(src),
  'WorkflowPanel adapter does not create unframed-start overrides',
);
assert(
  /frameTicket:\s*workflowFrameTicket/.test(src),
  'WorkflowPanel Start passes the stored framed ticket to the service',
);
assert(
  /canStartJob:\s*startReady\s*&&\s*workflowFrameTicketValid/.test(src),
  'WorkflowPanel Start button requires valid frame proof',
);
assert(
  /setWorkflowFrameTicket\(null\)/.test(src),
  'WorkflowPanel adapter clears stale frame proof when compile identity changes',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
