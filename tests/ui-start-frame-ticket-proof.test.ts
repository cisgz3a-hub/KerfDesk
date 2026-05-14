/**
 * T1-251 source pin: the UI must not forge a framed proof at Start
 * time. A framed FrameTicket is created when Frame succeeds and then
 * passed through to MachineService.startValidatedJob. Start may create
 * only the explicit unframed override ticket.
 *
 * Run: npx tsx tests/ui-start-frame-ticket-proof.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

const src = readFileSync(resolve('src/ui/components/ConnectionPanelMain.tsx'), 'utf8');

function blockBetween(startNeedle: string, endNeedle: string): string {
  const start = src.indexOf(startNeedle);
  assert(start >= 0, `${startNeedle} block exists`);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert(end > start, `${startNeedle} block terminates before ${endNeedle}`);
  return start >= 0 && end > start ? src.slice(start, end) : '';
}

console.log('\n=== ui start frame-ticket proof source pin ===\n');

const startBlock = blockBetween('const handleStartJob = async () => {', 'const confirmFrameBounds');
const safeFrameBlock = blockBetween('const handleFrameSafe = useCallback', 'const handleFrameDot');
const dotFrameBlock = blockBetween('const handleFrameDot = useCallback', 'const handleHome');

assert(
  /lastFrameTicketRef\s*=\s*useRef<FrameTicket\s*\|\s*null>\(null\)/.test(src),
  'panel stores the last real frame proof in lastFrameTicketRef',
);
assert(
  /lastFrameTicketRef\.current\s*=\s*null/.test(src),
  'frame proof is cleared by frame invalidation paths',
);
assert(
  /lastFrameTicketRef\.current\s*=\s*compiledJobTicket[\s\S]*createFramedStartTicket/.test(safeFrameBlock),
  'safe Frame success creates the framed proof at frame time',
);
assert(
  /lastFrameTicketRef\.current\s*=\s*compiledJobTicket[\s\S]*createFramedStartTicket/.test(dotFrameBlock),
  'Frame + Mark Center success creates the framed proof at frame time',
);
assert(
  /const\s+freshFrameTicket\s*=/.test(startBlock)
    && /lastFrameTicketRef\.current/.test(startBlock)
    && /const\s+frameTicket\s*=\s*freshFrameTicket/.test(startBlock)
    && /frameTicket,/.test(startBlock),
  'Start passes the stored frame proof, not a freshly forged proof',
);
assert(
  !/createFramedStartTicket/.test(startBlock),
  'Start handler does not create framed proof at Start time',
);
assert(
  /createUnframedStartOverrideTicket/.test(startBlock),
  'Start handler may still create an explicit logged unframed override',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
