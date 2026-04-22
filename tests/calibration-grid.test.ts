import { emitCalibrationGrid } from '../src/core/materials/CalibrationGrid';

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

function approxEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

function assertThrows(fn: () => void, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

console.log('\n=== CalibrationGrid: defaults ===');

const defaults = emitCalibrationGrid({
  materialName: 'Birch',
  scanSpeed: 1200,
});
assert(defaults.squares.length === 10, 'emitCalibrationGrid with defaults produces 10 squares');
assert(defaults.objects.length === 10, 'defaults objects length matches squares');
assert(defaults.layers.length === 10, 'defaults layers length matches squares');

console.log('\n=== CalibrationGrid: linear spacing ===');

const spacing = emitCalibrationGrid({
  materialName: 'Birch',
  scanSpeed: 1200,
  powerSteps: 10,
  powerMin: 5,
  powerMax: 95,
});
assert(approxEqual(spacing.squares[0].commandedPower, 5), 'first commandedPower equals powerMin');
assert(approxEqual(spacing.squares[spacing.squares.length - 1].commandedPower, 95), 'last commandedPower equals powerMax');
assert(
  approxEqual(spacing.squares[1].commandedPower - spacing.squares[0].commandedPower, 10),
  'commandedPower values are linearly spaced',
);

console.log('\n=== CalibrationGrid: ordering and bounds ===');

const ordered = emitCalibrationGrid({
  materialName: 'Birch',
  scanSpeed: 1400,
  powerSteps: 14,
});

const first = ordered.squares[0];
const second = ordered.squares[1];
const twelfth = ordered.squares[11];
const thirteenth = ordered.squares[12];

assert(
  second.bounds.y === first.bounds.y && second.bounds.x > first.bounds.x,
  'squares are left-to-right in first row',
);
assert(
  thirteenth.bounds.y > twelfth.bounds.y && thirteenth.bounds.x === first.bounds.x,
  'wrapped grids continue top-to-bottom then left-to-right',
);

let boundsMatch = true;
for (let i = 0; i < ordered.squares.length; i++) {
  const square = ordered.squares[i];
  const object = ordered.objects[i];
  if (object.geometry.type !== 'rect') {
    boundsMatch = false;
    break;
  }
  const matches =
    approxEqual(object.transform.tx, square.bounds.x) &&
    approxEqual(object.transform.ty, square.bounds.y) &&
    approxEqual(object.geometry.width, square.bounds.width) &&
    approxEqual(object.geometry.height, square.bounds.height);
  if (!matches) {
    boundsMatch = false;
    break;
  }
}
assert(boundsMatch, 'each rect bounds matches squares[i].bounds');

console.log('\n=== CalibrationGrid: per-layer settings ===');

const configured = emitCalibrationGrid({
  materialName: 'Birch',
  scanSpeed: 1800,
  powerSteps: 6,
  powerMin: 10,
  powerMax: 60,
});

const allFillModeAndSpeed = configured.layers.every(l => l.settings.mode === 'engrave' && approxEqual(l.settings.speed, 1800));
assert(allFillModeAndSpeed, 'all layers are fill mode with specified scanSpeed');

let powersMatch = true;
const powerSet = new Set<number>();
for (let i = 0; i < configured.layers.length; i++) {
  const power = configured.layers[i].settings.power.max;
  powerSet.add(power);
  if (!approxEqual(power, configured.squares[i].commandedPower) || !approxEqual(configured.layers[i].settings.power.min, power)) {
    powersMatch = false;
    break;
  }
}
assert(powersMatch, 'each layer power matches its square commandedPower');
assert(powerSet.size === configured.layers.length, 'each layer has distinct power value');

console.log('\n=== CalibrationGrid: invalid input guards ===');

assertThrows(
  () => emitCalibrationGrid({ materialName: 'Birch', scanSpeed: 1200, powerSteps: 1 }),
  'throws when powerSteps < 2',
);
assertThrows(
  () => emitCalibrationGrid({ materialName: 'Birch', scanSpeed: 1200, powerMin: 50, powerMax: 50 }),
  'throws when powerMin >= powerMax',
);
assertThrows(
  () => emitCalibrationGrid({ materialName: 'Birch', scanSpeed: 0 }),
  'throws when scanSpeed <= 0',
);
assertThrows(
  () => emitCalibrationGrid({ materialName: 'Birch', scanSpeed: 1200, squareSize: 0 }),
  'throws when squareSize <= 0',
);

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) throw new Error(`calibration-grid.test.ts: ${failed} assertion(s) failed`);
process.exit(0);
