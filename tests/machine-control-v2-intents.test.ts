import {
  assertMachineIntent,
  machineIntentRequiresExclusiveOperation,
  type MachineIntent,
} from '../src/machine-control-v2/MachineIntent';

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const start: MachineIntent = { kind: 'startJob', ticketId: 'ticket-1' };
const jog: MachineIntent = {
  kind: 'jog',
  axis: 'X',
  distanceMm: 10,
  feedMmPerMin: 2000,
};
const pause: MachineIntent = { kind: 'pauseJob' };
const resetWcs: MachineIntent = {
  kind: 'resetWcsToBaseline',
  axes: ['X', 'Y'],
};

assertMachineIntent(start);
assertMachineIntent(jog);
assertMachineIntent(pause);
assertMachineIntent(resetWcs);

assertEqual(machineIntentRequiresExclusiveOperation(start), true, 'start is exclusive');
assertEqual(machineIntentRequiresExclusiveOperation(jog), true, 'jog is exclusive');
assertEqual(machineIntentRequiresExclusiveOperation(pause), false, 'pause is realtime');
assertEqual(
  machineIntentRequiresExclusiveOperation({ kind: 'emergencyStop' }),
  false,
  'emergency stop bypasses queue',
);
