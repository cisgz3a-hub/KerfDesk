/**
 * T2-26 pass 1: semantic machine operations live on the controller.
 *
 * Run: npx tsx tests/controller-operations-api.test.ts
 */
import { readFileSync } from 'node:fs';
import { MockSerialPort } from '../src/communication/SerialPort';
import { GrblController } from '../src/controllers/grbl/GrblController';

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

function sent(port: MockSerialPort): string[] {
  return port.received.map((line) => line.trim());
}

async function connectedController(): Promise<{ ctrl: GrblController; port: MockSerialPort }> {
  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();
  await ctrl.connect(port);
  port.received.length = 0;
  return { ctrl, port };
}

async function run(): Promise<void> {
  console.log('\n=== T2-26 controller operations API ===\n');

  {
  const { ctrl, port } = await connectedController();
  const result = await ctrl.operations.unlockAlarm();
  assert(result.ok, 'unlockAlarm returns ok');
  assert(sent(port).includes('$X'), 'unlockAlarm emits GRBL $X inside controller');
  await ctrl.disconnect();
  }

  {
  const { ctrl, port } = await connectedController();
  const result = await ctrl.operations.home();
  assert(result.ok, 'home returns ok');
  assert(sent(port).includes('$H'), 'home emits GRBL $H inside controller');
  await ctrl.disconnect();
  }

  {
  const { ctrl, port } = await connectedController();
  const result = await ctrl.operations.jog({ axis: 'X', distanceMm: 2.5, feedMmPerMin: 1200 });
  assert(result.ok, 'jog returns ok');
  assert(sent(port).includes('$J=G91 G21 X2.5 F1200'), 'jog emits GRBL $J inside controller');
  await ctrl.disconnect();
  }

  {
  const { ctrl, port } = await connectedController();
  const result = await ctrl.operations.setWorkOriginAtCurrentPosition();
  assert(result.ok, 'setWorkOriginAtCurrentPosition returns ok');
  assert(sent(port).includes('G10 L20 P1 X0 Y0'), 'setWorkOriginAtCurrentPosition emits G10 L20 inside controller');
  await ctrl.disconnect();
  }

  {
  const { ctrl, port } = await connectedController();
  const result = await ctrl.operations.resetWcsToMachineOrigin();
  assert(result.ok, 'resetWcsToMachineOrigin returns ok');
  assert(sent(port).includes('G10 L2 P1 X0 Y0 Z0'), 'resetWcsToMachineOrigin emits G10 L2 inside controller');
  await ctrl.disconnect();
  }

  {
  const { ctrl, port } = await connectedController();
  const result = await ctrl.operations.testFire({ powerPercent: 5, maxSpindle: 1000 });
  assert(result.ok, 'testFire returns ok');
  assert(sent(port).includes('M3 S50'), 'testFire emits GRBL M3 S-value inside controller');
  await ctrl.disconnect();
  }

  {
  const { ctrl, port } = await connectedController();
  const result = await ctrl.operations.laserOff();
  assert(result.ok, 'laserOff returns ok when M5 path succeeds');
  assert(sent(port).includes('M5 S0'), 'laserOff emits M5 S0 inside controller safetyOff');
  await ctrl.disconnect();
  }

  {
  const ctrl = new GrblController();
  const result = await ctrl.operations.home();
  assert(!result.ok, 'operation failure is returned instead of thrown');
  assert(result.reason.toLowerCase().includes('not connected'), 'operation failure carries reason');
  }

  const iface = readFileSync('src/controllers/ControllerInterface.ts', 'utf8');
  const grbl = readFileSync('src/controllers/grbl/GrblController.ts', 'utf8');
  const coordinator = readFileSync('src/app/ExecutionCoordinator.ts', 'utf8');

  assert(/interface MachineOperationApi[\s\S]*jog/.test(iface), 'MachineOperationApi declares jog');
  assert(/interface MachineOperationApi[\s\S]*unlockAlarm/.test(iface), 'MachineOperationApi declares unlockAlarm');
  assert(/interface MachineOperationApi[\s\S]*setWorkOriginAtCurrentPosition/.test(iface), 'MachineOperationApi declares setWorkOriginAtCurrentPosition');
  assert(/interface MachineOperationApi[\s\S]*testFire/.test(iface), 'MachineOperationApi declares testFire');
  assert(/readonly operations: MachineOperationApi/.test(iface), 'GrblControllerApi exposes operations');
  assert(/readonly operations =/.test(grbl), 'GrblController implements operations object');
  assert(/_trySendInternalOperationCommand/.test(grbl), 'GRBL command strings are isolated behind operation helper');
  assert(/operations\.unlockAlarm\(\)/.test(coordinator), 'ExecutionCoordinator.unlock uses operations.unlockAlarm');
  assert(/operations\.home\(\)/.test(coordinator), 'ExecutionCoordinator.home uses operations.home');
  assert(/operations\.setWorkOriginAtCurrentPosition\(\)/.test(coordinator), 'ExecutionCoordinator.setOrigin uses operations.setWorkOriginAtCurrentPosition');
  assert(/operations\.testFire\(\{/.test(coordinator), 'ExecutionCoordinator.beginTestFire uses operations.testFire');
  assert(!/gateway\.unlock\(\)/.test(coordinator), 'ExecutionCoordinator no longer calls gateway.unlock');
  assert(!/gateway\.home\(\)/.test(coordinator), 'ExecutionCoordinator no longer calls gateway.home');
  assert(!/gateway\.sendInternalCommand\(cmd\)/.test(coordinator), 'ExecutionCoordinator.beginTestFire no longer sends laser-on through gateway');
  assert(!/setOriginAtCurrentPosition\(\);\n\s*return \{ ok: true \}/.test(coordinator), 'ExecutionCoordinator no longer forwards set-origin through gateway');

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void run();
