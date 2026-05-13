/**
 * T1-242: recovery-card action buttons must advance the runtime
 * RecoveryState checklist. Pre-fix, the buttons invoked machine
 * commands (Unlock/Home/Frame) but never called
 * MachineService.applyRecoveryAck(...), so Start stayed disabled
 * after the user completed the visible recovery steps.
 *
 * Run: npx tsx tests/recovery-card-actions-advance-state.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  OK ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const root = process.cwd();
const panel = readFileSync(resolve(root, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf8');
const cards = readFileSync(resolve(root, 'src/ui/recovery/RecoveryCardContent.ts'), 'utf8');
const surface = readFileSync(resolve(root, 'src/ui/recovery/RecoveryCard.tsx'), 'utf8');

console.log('\n=== T1-242 recovery card actions advance state ===\n');

// 1. The content model exposes an explicit inspection action so alarm
// recovery can complete its inspectionDone step through the UI.
assert(/T1-242/.test(cards), 'RecoveryCardContent carries T1-242 marker');
assert(/\|\s*'inspect'/.test(cards), 'RecoveryAction includes inspect');
assert(/actionLabel:[^]*inspect:\s*'Inspect done'/.test(surface), 'RecoveryCard labels inspect action');
assert(/Inspect the machine[^]*action:\s*'inspect'/.test(cards), 'Alarm recovery has an inspection action');

// 2. ConnectionPanelMain acknowledges each runtime recovery step from
// production UI actions. T1-244 refines the contract: reconnect and
// recompile are acknowledged only after successful reconnect/recompile
// work, not merely because the recovery-card button was clicked.
assert(/T1-242/.test(panel), 'ConnectionPanelMain carries T1-242 marker');
for (const step of ['inspection', 'unlock', 'rehome', 'reframe']) {
  assert(
    new RegExp(`applyRecoveryAck\\('${step}'\\)`).test(panel),
    `handleRecoveryAction acknowledges ${step}`,
  );
}
assert(/const acknowledgeReconnectRecovery = useCallback[\s\S]*applyRecoveryAck\('reconnect'\)/.test(panel),
  'successful reconnect acknowledges reconnect');
assert(/recompileOk\s*!==\s*false[\s\S]*applyRecoveryAck\('recompile'\)/.test(panel),
  'successful recompile acknowledges recompile');

// 3. Machine actions that must succeed before acknowledgement return a
// boolean success value. Otherwise a cancelled Home prompt or failed
// Frame could incorrectly clear the safety checklist.
assert(/const handleUnlock = useCallback\(async \(\): Promise<boolean>/.test(panel),
  'handleUnlock returns Promise<boolean>');
assert(/const handleHome = useCallback\(async \(\): Promise<boolean>/.test(panel),
  'handleHome returns Promise<boolean>');
assert(/const handleFrameSafe = useCallback\(async \(\): Promise<boolean>/.test(panel),
  'handleFrameSafe returns Promise<boolean>');

// 4. Emergency/safety recovery cards must wire actions too. Pre-fix
// this card rendered disabled buttons because no onAction was passed.
assert(/safetyRecoveryCard[^]*onAction:\s*handleRecoveryAction/.test(panel),
  'safetyRecoveryCard passes onAction');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
