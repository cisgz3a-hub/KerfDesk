/**
 * Golden checks: emitted G-code XY extents match machine-space plan moves.
 * Uses returnPosition: null so footer return G0 X0 Y0 is not mixed into extent parsing.
 */
import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { compileJob } from '../src/core/job/JobCompiler';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import { applyMachineTransform } from '../src/core/plan/MachineTransform';
import { getOutputStrategy } from '../src/core/output/Output';
import type { Plan } from '../src/core/plan/Plan';
import type { Job } from '../src/core/job/Job';
import type { GcodeStartMode } from '../src/core/output/GcodeOrigin';
import '../src/core/output/GrblStrategy';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
  assert(
    Math.abs(actual - expected) < tolerance,
    `${message} (actual=${actual.toFixed(4)}, expected=${expected.toFixed(4)})`,
  );
}

function moveExtents(plan: Plan): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const op of plan.operations) {
    for (const m of op.moves) {
      if (m.type === 'rapid' || m.type === 'linear') {
        minX = Math.min(minX, m.to.x);
        maxX = Math.max(maxX, m.to.x);
        minY = Math.min(minY, m.to.y);
        maxY = Math.max(maxY, m.to.y);
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

function gcodeXYExtents(gcode: string): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const line of gcode.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith(';')) continue;
    if (!/^G[01]\b/i.test(t)) continue;
    const mx = /\bX([-\d.]+)/i.exec(t);
    const my = /\bY([-\d.]+)/i.exec(t);
    if (!mx || !my) continue;
    const x = parseFloat(mx[1]);
    const y = parseFloat(my[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

function runCase(
  label: string,
  job: Job,
  plan: ReturnType<typeof optimizePlan>,
  startMode: GcodeStartMode,
  savedOrigin: { x: number; y: number } | null,
  flipY: boolean,
): void {
  const grbl = getOutputStrategy('grbl')!;
  const { plan: machinePlan } = applyMachineTransform(plan, {
    startMode,
    savedOrigin,
    flipY,
  });
  const pe = moveExtents(machinePlan);
  const text = grbl.generate(machinePlan, job, {
    startMode,
    savedOrigin: savedOrigin ?? undefined,
    returnPosition: null,
  }).text!;

  assert(text.includes('M2'), `${label} ${startMode}: program end present`);
  assert(
    !text.includes('return to job origin'),
    `${label} ${startMode}: return-to-origin move omitted (returnPosition null)`,
  );

  const ge = gcodeXYExtents(text);
  assert(Number.isFinite(ge.minX) && Number.isFinite(pe.minX), `${label} ${startMode}: extents are finite`);

  assertClose(ge.minX, pe.minX, 0.02, `${label} ${startMode}: gcode minX vs plan`);
  assertClose(ge.maxX, pe.maxX, 0.02, `${label} ${startMode}: gcode maxX vs plan`);
  assertClose(ge.minY, pe.minY, 0.02, `${label} ${startMode}: gcode minY vs plan`);
  assertClose(ge.maxY, pe.maxY, 0.02, `${label} ${startMode}: gcode maxY vs plan`);

  assertClose(pe.maxX - pe.minX, 40, 0.02, `${label} ${startMode}: span X = 40mm (rect width)`);
  assertClose(pe.maxY - pe.minY, 30, 0.02, `${label} ${startMode}: span Y = 30mm (rect height)`);
}

console.log('\n=== Placement: G-code extents match machine plan (golden) ===');

const scene = createScene(500, 500, 'Placement');
const layer = scene.layers[0];
const rect = createRect(layer.id, 100, 50, 40, 30, 'Box');
scene.objects.push(rect);

const job: Job = compileJob(scene);
const plan = optimizePlan(job);
assert(plan.operations.length >= 1, 'placement: plan has at least one operation');
assert(getOutputStrategy('grbl') !== undefined, 'placement: GRBL strategy registered');

const startModes: GcodeStartMode[] = ['absolute', 'current', 'savedOrigin'];
const savedForSavedOrigin: { x: number; y: number } = { x: 120, y: 75 };

for (const startMode of startModes) {
  const saved = startMode === 'savedOrigin' ? savedForSavedOrigin : null;
  runCase('flipY', job, plan, startMode, saved, true);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) {
  process.exit(1);
}
