/**
 * T3-92: the connected drawer exposes LightBurn-style "Go to last position"
 * without bypassing the existing jog safety path.
 *
 * Run: npx tsx tests/connection-panel-go-to-last-position.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const root = process.cwd();
const panel = readFileSync(resolve(root, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');
const jog = readFileSync(resolve(root, 'src/ui/components/connection/Jog.tsx'), 'utf-8');

console.log('\n=== T3-92 connection panel go-to-last-position wiring ===\n');

assertContract(
  /LastMachinePosition/.test(panel),
  'ConnectionPanelMain imports the last-position helper',
);
assertContract(
  /lastJobStartPosition/.test(panel),
  'ConnectionPanelMain owns session-local lastJobStartPosition state',
);
assertContract(
  /captureLastJobStartPosition\([\s\S]*machinePosition[\s\S]*machineState\?\.position/.test(panel),
  'handleStartJob captures the machine head position at accepted job start',
);
assertContract(
  /setLastJobStartPosition\(null\)/.test(panel),
  'ConnectionPanelMain clears the stored last position on disconnect or unsafe loss of trust',
);
assertContract(
  /const handleGoToLastPosition = useCallback/.test(panel),
  'ConnectionPanelMain defines a go-to-last-position handler',
);
assertContract(
  /buildGoToLastPositionJogs\(/.test(panel)
  && /executionCoordinator\.jog\(move\.axis, move\.distance, 3000\)/.test(panel),
  'go-to-last-position uses planned relative jogs through ExecutionCoordinator.jog',
);
assertContract(
  /onGoToLastPosition: \(\) => \{ void handleGoToLastPosition\(\); \}/.test(panel),
  'Jog receives the go-to-last-position handler from the fixed Move Laser zone',
);
assertContract(
  /Go to last position/.test(jog),
  'Jog renders a clear Go to last position button',
);
assertContract(
  /canGoToLastPosition/.test(jog)
  && /disabled: !canGoToLastPosition/.test(jog),
  'Jog disables the button until the safe movement gate is satisfied',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
