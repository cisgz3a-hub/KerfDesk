/**
 * T2-26 guard: coordinator operation routing must not regress to generic
 * GRBL command streaming.
 *
 * Run: npx tsx tests/t2-26-operation-routing-static-guard.test.ts
 */
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  OK ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const coordinator = readFileSync('src/app/ExecutionCoordinator.ts', 'utf8');
const appFrame = readFileSync('src/app/frameGcode.ts', 'utf8');
const grblFrame = readFileSync('src/controllers/grbl/GrblFrameGcode.ts', 'utf8');
const grblController = readFileSync('src/controllers/grbl/GrblController.ts', 'utf8');
const iface = readFileSync('src/controllers/ControllerInterface.ts', 'utf8');
const gateway = readFileSync('src/app/MachineCommandGateway.ts', 'utf8');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const coordinatorCode = stripComments(coordinator);
const gatewayCode = stripComments(gateway);

console.log('\n=== T2-26 operation routing static guard ===\n');

assert(!coordinator.includes('MachineCommandGateway'), 'ExecutionCoordinator no longer imports or creates MachineCommandGateway');
assert(!/sendInternalCommand\((cmd|line)\)/.test(coordinator), 'ExecutionCoordinator no longer sends operation commands through gateway');
assert(!/TEST_FIRE_LASER_ON_WORD/.test(coordinatorCode), 'ExecutionCoordinator no longer owns the test-fire protocol word');
assert(!/`?\$J=|['"]\$X['"]|['"]\$H['"]|G10 L20|G10 L2|['"]M5 S0['"]|['"]M3['"]/.test(coordinatorCode), 'ExecutionCoordinator contains no GRBL command literals outside comments/log text');
assert(/operations\.jog\(\{/.test(coordinator), 'ExecutionCoordinator jog uses operations.jog');
assert(/operations\.testFire\(\{/.test(coordinator), 'ExecutionCoordinator beginTestFire uses operations.testFire');
assert(/operations\.frame\(\{/.test(coordinator), 'ExecutionCoordinator frame uses operations.frame');
assert(/operations\.laserOff\(\{[\s\S]*emergency: true[\s\S]*onCommand: line => this\.notifySimulator\(line\)/.test(coordinator), 'ExecutionCoordinator laser-off uses operations.laserOff');
assert(/operations\.setWorkOriginAtCurrentPosition\(\{[\s\S]*onCommand: line => this\.notifySimulator\(line\)/.test(coordinator), 'ExecutionCoordinator set-origin uses operations.setWorkOriginAtCurrentPosition');
assert(/onCommand: line => this\.notifySimulator\(line\)/.test(coordinator), 'ExecutionCoordinator receives simulator lines from controller operations');

assert(!/sendInternalCommand|unlock\(\)|home\(\)|setOriginAtCurrentPosition\(\)|resetWcsToMachineOrigin\(\)|jog\(|laserOff\(\)/.test(gatewayCode), 'MachineCommandGateway no longer exposes stale operation helpers');
assert(!/`?\$J=|['"]\$X['"]|['"]\$H['"]|G10 L20|G10 L2|['"]M5 S0['"]|['"]M3['"]/.test(gatewayCode), 'MachineCommandGateway contains no GRBL operation command literals');

assert(!/\bM[345]\s*S/.test(appFrame), 'src/app/frameGcode.ts does not contain GRBL M-code construction');
assert(!/\bG[019]\b/.test(appFrame), 'src/app/frameGcode.ts does not contain GRBL motion/modal construction');
assert(/buildGrblFrameGcode as buildFrameGcode/.test(appFrame), 'app frame module re-exports GRBL frame builder only for compatibility');

assert(/M4 S\$\{frameDotS\}/.test(grblFrame), 'GRBL frame builder owns frame-dot M4 construction');
assert(/M5 S0/.test(grblFrame), 'GRBL frame builder owns frame laser-off construction');
assert(/G0 X/.test(grblFrame) && /G1 X/.test(grblFrame), 'GRBL frame builder owns frame motion construction');
assert(/frame\(args:/.test(iface), 'MachineOperationApi declares frame operation');
assert(/testFire\(args:/.test(iface), 'MachineOperationApi declares testFire operation');
assert(/onCommand\?: \(line: string\) => void/.test(iface), 'MachineOperationApi exposes optional operation command observer');
assert(/frame: async/.test(grblController), 'GrblController implements frame operation');
assert(/testFire: async/.test(grblController), 'GrblController implements testFire operation');
assert(/_trySendInternalOperationCommand\(command: string, onCommand\?/.test(grblController), 'GrblController reports operation command lines from inside the controller');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
