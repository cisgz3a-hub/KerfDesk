/**
 * T2-24: controller contract split.
 *
 * Run: npx tsx tests/controller-interface-protocol-neutral.test.ts
 */
import { readFileSync } from 'node:fs';
import { GrblController } from '../src/controllers/grbl/GrblController';
import { isGrblControllerApi } from '../src/controllers/ControllerInterface';

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

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function interfaceBody(src: string, name: string): string {
  const marker = `export interface ${name}`;
  const start = src.indexOf(marker);
  if (start < 0) return '';
  const open = src.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return '';
}

console.log('\n=== T2-24 controller protocol split ===\n');

const controllerInterface = source('src/controllers/ControllerInterface.ts');
const grblController = source('src/controllers/grbl/GrblController.ts');
const machineService = source('src/app/MachineService.ts');
const executionCoordinator = source('src/app/ExecutionCoordinator.ts');

const protocolNeutralBody = interfaceBody(controllerInterface, 'ProtocolNeutralLaserController');
const gcodeBody = interfaceBody(controllerInterface, 'GcodeLineController');
const grblBody = interfaceBody(controllerInterface, 'GrblControllerApi');
const progressBody = interfaceBody(controllerInterface, 'ProtocolNeutralJobProgress');

assert(controllerInterface.includes('export interface ProtocolNeutralLaserController'), 'ProtocolNeutralLaserController is exported');
assert(controllerInterface.includes('export interface GcodeLineController'), 'GcodeLineController extension is exported');
assert(controllerInterface.includes('export interface GrblControllerApi'), 'GrblControllerApi extension is exported');
assert(controllerInterface.includes('export interface LaserController extends GrblControllerApi'), 'legacy LaserController facade points at GRBL extension');
assert(controllerInterface.includes('export function isGrblControllerApi'), 'runtime GRBL narrowing helper is exported');

for (const leak of [
  'SerialPortLike',
  'sendJob',
  'sendCommand',
  'maxSpindle',
  'getFirmware',
  'Wcs',
  'setStopOnError',
]) {
  assert(!protocolNeutralBody.includes(leak), `ProtocolNeutralLaserController does not expose ${leak}`);
}

for (const progressLeak of ['bufferFill', 'ackRateHz', 'expectedAckRateHz', 'linesSent']) {
  assert(!progressBody.includes(progressLeak), `ProtocolNeutralJobProgress does not expose ${progressLeak}`);
}

assert(gcodeBody.includes('SerialPortLike'), 'GcodeLineController owns serial line-stream connect shape');
assert(gcodeBody.includes('sendJob(lines: string[])'), 'GcodeLineController owns line-based sendJob');
assert(gcodeBody.includes('sendCommand(command: string'), 'GcodeLineController owns raw command send');
assert(grblBody.includes('maxSpindle'), 'GrblControllerApi owns GRBL $30 maxSpindle');
assert(grblBody.includes('getFirmwareHomingCycleEnabled'), 'GrblControllerApi owns GRBL firmware homing query');
assert(grblBody.includes('getCurrentWcsState'), 'GrblControllerApi owns GRBL WCS state');
assert(grblBody.includes('setStopOnError'), 'GrblControllerApi owns GRBL stop-on-error policy');
assert(/implements\s+GrblControllerApi/.test(grblController), 'GrblController implements GrblControllerApi');
assert(/readonly\s+family\s*=\s*'grbl'/.test(grblController), 'GrblController declares its GRBL family');

assert(!/controllers[\\/]+grbl/.test(machineService), 'MachineService does not import controllers/grbl directly');
assert(!/controllers[\\/]+grbl/.test(executionCoordinator), 'ExecutionCoordinator does not import controllers/grbl directly');

const ctrl = new GrblController();
assert(isGrblControllerApi(ctrl), 'isGrblControllerApi recognizes GrblController');
assert(!isGrblControllerApi({}), 'isGrblControllerApi rejects unrelated objects');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
