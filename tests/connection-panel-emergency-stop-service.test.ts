/**
 * T2-41/T2-46 followup: the UI emergency-stop button must consume the
 * MachineService safety-result path instead of bypassing it with direct
 * controller calls and a second disconnect.
 *
 * Run: npx tsx tests/connection-panel-emergency-stop-service.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  fail - ${message}`);
  }
}

const source = readFileSync(
  resolve(process.cwd(), 'src/ui/components/ConnectionPanelMain.tsx'),
  'utf-8',
);

console.log('\n=== connection panel emergency-stop service path ===\n');

const labelIndex = source.indexOf('EMERGENCY STOP');
assertContract(labelIndex >= 0, 'emergency-stop button label exists');

const buttonStart = source.lastIndexOf("React.createElement('button'", labelIndex);
const buttonEnd = source.indexOf('),', labelIndex);
assertContract(buttonStart >= 0 && buttonEnd > buttonStart, 'emergency-stop button block can be isolated');

const buttonBlock = source.slice(buttonStart, buttonEnd);

assertContract(
  /machineService\.emergencyStop\(\)/.test(buttonBlock),
  'emergency-stop button routes through MachineService.emergencyStop()',
);
assertContract(
  !/controllerRef\.current\?\.emergencyStop\(\)/.test(buttonBlock),
  'emergency-stop button does not bypass MachineService with a direct controller call',
);
assertContract(
  !/machineService\.disconnect\(\)/.test(buttonBlock),
  'emergency-stop button does not run a second disconnect after emergencyStop()',
);
assertContract(
  /portRef\.current\s*=\s*null/.test(buttonBlock),
  'emergency-stop button still clears the UI port ref',
);
assertContract(
  /setIsPaused\(false\)/.test(buttonBlock),
  'emergency-stop button still clears paused UI state',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
