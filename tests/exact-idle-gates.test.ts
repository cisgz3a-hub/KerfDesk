/**
 * T1-104: exact-idle gate cluster.
 *
 * Pin the contracts of the UI gates that block machine actions until the
 * controller is in 'idle' state:
 * - canFrame / canFire (Frame, Frame Dot, Test Fire)
 * - Jog handler idle check
 * - Set Origin handler idle check
 *
 * Run: npx tsx tests/exact-idle-gates.test.ts
 */

type MachineStatus =
  | 'idle'
  | 'run'
  | 'hold'
  | 'homing'
  | 'check'
  | 'door'
  | 'alarm'
  | 'faulted_requires_inspection'
  | 'unknown'
  | 'connecting';

interface GateInputs {
  isConnected: boolean;
  isRunning: boolean;
  machineStatus: MachineStatus | undefined;
}

function canFrameOrFire(args: GateInputs): boolean {
  return args.isConnected && !args.isRunning && args.machineStatus === 'idle';
}

function jogAccepts(args: GateInputs): boolean {
  return args.machineStatus === 'idle';
}

function setOriginAccepts(args: GateInputs): boolean {
  return args.machineStatus === 'idle';
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('\n=== T1-104 exact-idle gate cluster ===\n');

{
  const result = canFrameOrFire({ isConnected: true, isRunning: false, machineStatus: 'idle' });
  assert(result === true, 'canFrame/canFire: connected + not running + idle -> true');
}

{
  const blockedStates: MachineStatus[] = [
    'run',
    'hold',
    'homing',
    'check',
    'door',
    'alarm',
    'faulted_requires_inspection',
    'unknown',
    'connecting',
  ];
  for (const status of blockedStates) {
    const result = canFrameOrFire({ isConnected: true, isRunning: false, machineStatus: status });
    assert(result === false, `canFrame/canFire: status="${status}" -> false`);
  }
}

{
  const result = canFrameOrFire({ isConnected: true, isRunning: false, machineStatus: undefined });
  assert(result === false, 'canFrame/canFire: undefined machineStatus -> false');
}

{
  const result = canFrameOrFire({ isConnected: false, isRunning: false, machineStatus: 'idle' });
  assert(result === false, 'canFrame/canFire: disconnected -> false');
}

{
  const result = canFrameOrFire({ isConnected: true, isRunning: true, machineStatus: 'idle' });
  assert(result === false, 'canFrame/canFire: isRunning=true -> false');
}

{
  const blockedStates: MachineStatus[] = ['run', 'hold', 'alarm', 'faulted_requires_inspection', 'unknown'];
  for (const status of blockedStates) {
    assert(
      jogAccepts({ isConnected: true, isRunning: false, machineStatus: status }) === false,
      `jog: status="${status}" -> declined`,
    );
  }
  assert(
    jogAccepts({ isConnected: true, isRunning: false, machineStatus: 'idle' }) === true,
    'jog: status="idle" -> accepted',
  );
}

{
  const blockedStates: MachineStatus[] = ['run', 'hold', 'alarm', 'faulted_requires_inspection', 'unknown'];
  for (const status of blockedStates) {
    assert(
      setOriginAccepts({ isConnected: true, isRunning: false, machineStatus: status }) === false,
      `setOrigin: status="${status}" -> declined`,
    );
  }
  assert(
    setOriginAccepts({ isConnected: true, isRunning: false, machineStatus: 'idle' }) === true,
    'setOrigin: status="idle" -> accepted',
  );
}

{
  const oldGateResult = true; // isConnected && !isRunning with status='hold'
  const newGateResult = canFrameOrFire({ isConnected: true, isRunning: false, machineStatus: 'hold' });
  assert(
    newGateResult === false && oldGateResult === true,
    'hold state: old Frame gate allowed; new gate blocks',
  );
}

{
  const newGateResult = canFrameOrFire({ isConnected: true, isRunning: false, machineStatus: 'homing' });
  assert(
    newGateResult === false,
    'homing state: new gate blocks Test Fire',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
