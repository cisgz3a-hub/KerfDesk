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

console.log('\n=== T2-26 operation routing static guard ===\n');

assert(!coordinator.includes('MachineCommandGateway'), 'ExecutionCoordinator no longer imports or creates MachineCommandGateway');
assert(!/sendInternalCommand\((cmd|line)\)/.test(coordinator), 'ExecutionCoordinator no longer sends operation commands through gateway');
assert(/operations\.jog\(\{/.test(coordinator), 'ExecutionCoordinator jog uses operations.jog');
assert(/operations\.testFire\(\{/.test(coordinator), 'ExecutionCoordinator beginTestFire uses operations.testFire');
assert(/operations\.frame\(\{/.test(coordinator), 'ExecutionCoordinator frame uses operations.frame');
assert(/operations\.laserOff\(\{ emergency: true \}\)/.test(coordinator), 'ExecutionCoordinator laser-off uses operations.laserOff');
assert(/operations\.setWorkOriginAtCurrentPosition\(\)/.test(coordinator), 'ExecutionCoordinator set-origin uses operations.setWorkOriginAtCurrentPosition');

assert(!/\bM[345]\s*S/.test(appFrame), 'src/app/frameGcode.ts does not contain GRBL M-code construction');
assert(!/\bG[019]\b/.test(appFrame), 'src/app/frameGcode.ts does not contain GRBL motion/modal construction');
assert(/buildGrblFrameGcode as buildFrameGcode/.test(appFrame), 'app frame module re-exports GRBL frame builder only for compatibility');

assert(/M4 S\$\{frameDotS\}/.test(grblFrame), 'GRBL frame builder owns frame-dot M4 construction');
assert(/M5 S0/.test(grblFrame), 'GRBL frame builder owns frame laser-off construction');
assert(/G0 X/.test(grblFrame) && /G1 X/.test(grblFrame), 'GRBL frame builder owns frame motion construction');
assert(/frame\(args:/.test(iface), 'MachineOperationApi declares frame operation');
assert(/testFire\(args:/.test(iface), 'MachineOperationApi declares testFire operation');
assert(/frame: async/.test(grblController), 'GrblController implements frame operation');
assert(/testFire: async/.test(grblController), 'GrblController implements testFire operation');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
