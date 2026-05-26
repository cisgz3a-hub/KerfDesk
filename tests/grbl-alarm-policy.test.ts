/**
 * GRBL4040 alarm-code policy. The recovery UI and unlock path must use
 * one shared interpretation of GRBL ALARM:N instead of hand-written
 * per-component guesses.
 *
 * Run: npx tsx tests/grbl-alarm-policy.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { alarmCodeReason } from '../src/ui/recovery/RecoveryCardContent';

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

console.log('\n=== GRBL alarm policy ===\n');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const policyPath = resolve(repoRoot, 'src/controllers/grbl/GrblAlarmPolicy.ts');

const expectedReasons = new Map<number, RegExp>([
  [1, /hard limit/i],
  [2, /soft limit|exceeds travel/i],
  [3, /reset while in motion/i],
  [4, /probe fail.*initial/i],
  [5, /probe fail.*contact/i],
  [6, /homing fail.*reset/i],
  [7, /homing fail.*door/i],
  [8, /homing fail.*pull-off|clear limit/i],
  [9, /homing fail.*find limit|limit switch/i],
  [10, /homing fail.*dual/i],
]);

for (const [code, pattern] of expectedReasons) {
  assert(pattern.test(alarmCodeReason(code)),
    `alarmCodeReason(${code}) matches official GRBL meaning (got "${alarmCodeReason(code)}")`);
}
assert(/unknown/i.test(alarmCodeReason(99)),
  `alarmCodeReason(99) is unknown-code safe copy (got "${alarmCodeReason(99)}")`);

async function run(): Promise<void> {
  assert(existsSync(policyPath), 'shared GrblAlarmPolicy.ts helper exists');

  if (existsSync(policyPath)) {
    const policy = await import(pathToFileURL(policyPath).href) as {
      alarmInvalidatesPositionProof: (code: number | null | undefined) => boolean;
      alarmAllowsRetainingPositionProof: (code: number | null | undefined) => boolean;
      describeGrblAlarmCode: (code: number | null | undefined) => string;
    };

    for (const code of [1, 3, 6, 7, 8, 9, 10, 0, 99]) {
      assert(policy.alarmInvalidatesPositionProof(code),
        `ALARM:${code} invalidates frame/WCS/origin proof`);
      assert(!policy.alarmAllowsRetainingPositionProof(code),
        `ALARM:${code} does not retain position proof`);
    }

    for (const code of [2, 4, 5]) {
      assert(!policy.alarmInvalidatesPositionProof(code),
        `ALARM:${code} does not clear job frame/WCS proof after unlock`);
      assert(policy.alarmAllowsRetainingPositionProof(code),
        `ALARM:${code} retains position proof after unlock`);
    }

    assert(/soft limit|exceeds travel/i.test(policy.describeGrblAlarmCode(2)),
      'shared policy describes ALARM:2 as soft-limit travel exceeded');
    assert(/dual/i.test(policy.describeGrblAlarmCode(10)),
      'shared policy describes ALARM:10 as dual-axis homing failure');
  }

  const connectionPanel = readFileSync(
    resolve(repoRoot, 'src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(/alarmInvalidatesPositionProof/.test(connectionPanel),
    'ConnectionPanelMain uses shared alarmInvalidatesPositionProof helper');
  assert(!/alarmCode\s*===\s*1/.test(connectionPanel),
    'ConnectionPanelMain no longer hard-codes only ALARM:1 as position-lost');

  const recoveryCard = readFileSync(
    resolve(repoRoot, 'src/ui/recovery/RecoveryCardContent.ts'),
    'utf-8',
  );
  assert(/describeGrblAlarmCode/.test(recoveryCard),
    'RecoveryCardContent delegates alarm copy to shared GRBL alarm policy');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void run();
