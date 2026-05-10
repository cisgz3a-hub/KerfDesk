/**
 * T2-6 Phase 3t: pure-helper coverage for the GRBL-derived machine-info
 * hook. The hook itself wraps these in useMemo with the same dep keys
 * App.tsx used pre-extraction; if the helpers behave, the hook does
 * too. Pinning the helpers (not the hook) avoids dragging React into
 * the test runner just to assert pure conditional logic.
 *
 * Run: npx tsx tests/grbl-derived-machine-info.test.ts
 */
import { type MachineState } from '../src/controllers/ControllerInterface';
import { type GrblMachineInfo } from '../src/controllers/grbl/GrblController';
import { type MachineTransformResult } from '../src/core/plan/MachineTransform';
import {
  resolveAccelFromGrblInfo,
  resolveBedFromGrblInfo,
  resolveLiveJobCanvasPosition,
  resolveMachinePositionForWizard,
} from '../src/ui/hooks/useGrblDerivedMachineInfo';

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

const idle: MachineState = {
  status: 'idle',
  position: { x: 100, y: 50, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};
const disconnected: MachineState = { ...idle, status: 'disconnected' };
const connecting: MachineState = { ...idle, status: 'connecting' };

const fullInfo: GrblMachineInfo = {
  bedWidth: 363,
  bedHeight: 273,
  homingDir: 0,
  maxSpindle: 1000,
  laserMode: true,
  maxFeedX: 12000,
  maxFeedY: 12000,
  maxAccelX: 800,
  maxAccelY: 600,
};

console.log('\n=== T2-6 Phase 3t: GRBL-derived machine-info helpers ===\n');

// -------- resolveMachinePositionForWizard --------
{
  assert(resolveMachinePositionForWizard(null) === null,
    'null state → null wizard position');
  assert(resolveMachinePositionForWizard(undefined) === null,
    'undefined state → null wizard position');
  assert(resolveMachinePositionForWizard(disconnected) === null,
    'disconnected state → null wizard position');
  assert(resolveMachinePositionForWizard(connecting) === null,
    'connecting state → null wizard position');
  const pos = resolveMachinePositionForWizard(idle);
  assert(pos !== null && pos.x === 100 && pos.y === 50,
    'idle state returns {x, y} from machine position');
}

// -------- resolveLiveJobCanvasPosition --------
{
  assert(
    resolveLiveJobCanvasPosition({ isJobRunning: false, state: idle, transform: null }) === null,
    'no job running → null live position',
  );
  assert(
    resolveLiveJobCanvasPosition({ isJobRunning: true, state: null, transform: null }) === null,
    'job running but null state → null live position',
  );
  assert(
    resolveLiveJobCanvasPosition({ isJobRunning: true, state: disconnected, transform: null }) === null,
    'job running but disconnected → null live position',
  );
  assert(
    resolveLiveJobCanvasPosition({ isJobRunning: true, state: connecting, transform: null }) === null,
    'job running but connecting → null live position',
  );

  const noTransform = resolveLiveJobCanvasPosition({
    isJobRunning: true,
    state: idle,
    transform: null,
  });
  assert(noTransform !== null && noTransform.x === 100 && noTransform.y === 50,
    'no transform → live position equals machine position');

  const flipYTransform: MachineTransformResult = {
    plan: { id: 'p', operations: [], bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } } as unknown as MachineTransformResult['plan'],
    offsetX: 10,
    offsetY: 5,
    flipReferenceY: 200,
    flipY: true,
    returnPosition: { x: 0, y: 0 },
  };
  const flipped = resolveLiveJobCanvasPosition({
    isJobRunning: true,
    state: idle,
    transform: flipYTransform,
  });
  // canvasX = 100 - 10 = 90; canvasY = 200 - 50 + 5 = 155
  assert(flipped !== null && flipped.x === 90 && flipped.y === 155,
    'flipY transform: canvasY = flipReferenceY - wp.y + offsetY');

  const noFlip: MachineTransformResult = { ...flipYTransform, flipY: false };
  const unflipped = resolveLiveJobCanvasPosition({
    isJobRunning: true,
    state: idle,
    transform: noFlip,
  });
  // canvasX = 100 - 10 = 90; canvasY = 50 - 5 = 45
  assert(unflipped !== null && unflipped.x === 90 && unflipped.y === 45,
    'no flipY: canvasY = wp.y - offsetY');
}

// -------- resolveBedFromGrblInfo --------
{
  assert(resolveBedFromGrblInfo(null) === null, 'null info → null bed');
  const zero: GrblMachineInfo = { ...fullInfo, bedWidth: 0, bedHeight: 0 };
  assert(resolveBedFromGrblInfo(zero) === null, 'both bed dims zero → null');
  const onlyW: GrblMachineInfo = { ...fullInfo, bedHeight: 0 };
  assert(resolveBedFromGrblInfo(onlyW) === null, 'one bed dim zero → null');
  const bed = resolveBedFromGrblInfo(fullInfo);
  assert(bed !== null && bed.width === 363 && bed.height === 273,
    'both positive → returns {width, height}');
}

// -------- resolveAccelFromGrblInfo --------
{
  assert(resolveAccelFromGrblInfo(null) === null, 'null info → null accel');
  const zero: GrblMachineInfo = { ...fullInfo, maxAccelX: 0, maxAccelY: 0 };
  assert(resolveAccelFromGrblInfo(zero) === null, 'both accels zero → null');
  const onlyX: GrblMachineInfo = { ...fullInfo, maxAccelY: 0 };
  assert(resolveAccelFromGrblInfo(onlyX) === 800, 'only X positive → returns X');
  const onlyY: GrblMachineInfo = { ...fullInfo, maxAccelX: 0 };
  assert(resolveAccelFromGrblInfo(onlyY) === 600, 'only Y positive → returns Y');
  assert(resolveAccelFromGrblInfo(fullInfo) === 600,
    'both positive → returns the smaller (Y here)');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
