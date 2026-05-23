import { createEmptyJob, type Job, type Operation, type ResolvedLaserSettings } from '../src/core/job/Job';
import { createEmptyPlan, type Plan, type Move } from '../src/core/plan/Plan';
import { getOutputStrategy } from '../src/core/output/Output';
import { type GcodeChunk } from '../src/core/output/GcodeStreaming';
import { type GcodeStartMode } from '../src/core/output/GcodeOrigin';
import '../src/core/output/GrblStrategy';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const settings: ResolvedLaserSettings = {
  powerMin: 0,
  powerMax: 100,
  speed: 1200,
  passes: 1,
  zStepPerPass: 0,
  fillInterval: 0,
  fillAngle: 0,
  fillMode: 'line',
  fillBiDirectional: false,
  overscanning: 0,
  overcut: 0,
  leadIn: 0,
  tabCount: 0,
  tabWidth: 0,
  insideFirst: false,
  airAssist: false,
  accelAwarePower: false,
  maxAccelMmPerS2: 1000,
  minPowerRatioAccel: 0,
  scanningOffsets: [],
};

function makeJobAndPlan(name: string, moves: Move[]): { job: Job; plan: Plan } {
  const job = createEmptyJob(name, 'lf-001-state-isolation');
  const op: Operation = {
    id: `${name}-operation`,
    layerId: `${name}-layer`,
    layerName: `${name} layer`,
    layerColor: '#ff0000',
    order: 0,
    type: 'cut',
    settings,
    geometry: { type: 'vector', paths: [] },
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
  };
  job.operations.push(op);
  job.bounds = op.bounds;
  job.metadata.objectCount = 1;
  job.metadata.layerCount = 1;

  const plan = createEmptyPlan(job.id);
  plan.operations.push({
    operationId: op.id,
    layerName: op.layerName,
    layerColor: op.layerColor,
    passIndex: 0,
    moves,
  });
  return { job, plan };
}

async function collectGenerated(
  plan: Plan,
  job: Job,
  options: { startMode?: GcodeStartMode; maxSpindle?: number } = {},
): Promise<string> {
  const strategy = getOutputStrategy('grbl');
  if (!strategy?.generateGcode) throw new Error('GRBL generateGcode strategy is not registered');
  const lines: string[] = [];
  for await (const chunk of strategy.generateGcode(plan, job, {
    chunkLines: 2,
    clock: () => '2026-05-17T00:00:00.000Z',
    ...options,
  })) {
    lines.push(...chunk.lines);
  }
  return lines.join('\n');
}

async function collectInterleaved(
  a: { plan: Plan; job: Job; options: { startMode?: GcodeStartMode; maxSpindle?: number } },
  b: { plan: Plan; job: Job; options: { startMode?: GcodeStartMode; maxSpindle?: number } },
): Promise<{ a: string; b: string }> {
  const strategy = getOutputStrategy('grbl');
  if (!strategy?.generateGcode) throw new Error('GRBL generateGcode strategy is not registered');

  const iterA = strategy.generateGcode(a.plan, a.job, {
    chunkLines: 2,
    clock: () => '2026-05-17T00:00:00.000Z',
    ...a.options,
  })[Symbol.asyncIterator]();
  const iterB = strategy.generateGcode(b.plan, b.job, {
    chunkLines: 2,
    clock: () => '2026-05-17T00:00:00.000Z',
    ...b.options,
  })[Symbol.asyncIterator]();

  const aLines: string[] = [];
  const bLines: string[] = [];
  let aDone = false;
  let bDone = false;

  while (!aDone || !bDone) {
    if (!aDone) {
      const next = await iterA.next();
      aDone = Boolean(next.done);
      if (!next.done) aLines.push(...(next.value as GcodeChunk).lines);
    }
    if (!bDone) {
      const next = await iterB.next();
      bDone = Boolean(next.done);
      if (!next.done) bLines.push(...(next.value as GcodeChunk).lines);
    }
  }

  return {
    a: aLines.join('\n'),
    b: bLines.join('\n'),
  };
}

const jobA = makeJobAndPlan('relative-job-a', [
  { type: 'rapid', to: { x: 5, y: 5 } },
  { type: 'laserOn', power: 50 },
  { type: 'linear', to: { x: 15, y: 5 }, power: 50, speed: 1200 },
  { type: 'setZ', z: -1 },
  { type: 'linear', to: { x: 25, y: 15 }, power: 25, speed: 800 },
  { type: 'laserOff' },
]);
const jobB = makeJobAndPlan('absolute-job-b', [
  { type: 'rapid', to: { x: 2, y: 3 } },
  { type: 'laserOn', power: 80 },
  { type: 'linear', to: { x: 10, y: 3 }, power: 80, speed: 600 },
  { type: 'setZ', z: -2 },
  { type: 'linear', to: { x: 12, y: 8 }, power: 40, speed: 400 },
  { type: 'laserOff' },
]);

console.log('\n=== LF-001 G-code encoder state isolation ===\n');

async function main(): Promise<void> {
  const baselineA = await collectGenerated(jobA.plan, jobA.job, {
    startMode: 'current',
    maxSpindle: 1000,
  });
  const baselineB = await collectGenerated(jobB.plan, jobB.job, {
    startMode: 'absolute',
    maxSpindle: 255,
  });

  const repeatedA = await collectGenerated(jobA.plan, jobA.job, {
    startMode: 'current',
    maxSpindle: 1000,
  });
  assert(repeatedA === baselineA, 'repeated compile of the same job is deterministic');

  await collectGenerated(jobA.plan, jobA.job, { startMode: 'current', maxSpindle: 1000 });
  const bAfterA = await collectGenerated(jobB.plan, jobB.job, { startMode: 'absolute', maxSpindle: 255 });
  assert(bAfterA === baselineB, 'compiling job A before job B does not change job B output');

  await collectGenerated(jobB.plan, jobB.job, { startMode: 'absolute', maxSpindle: 255 });
  const aAfterB = await collectGenerated(jobA.plan, jobA.job, { startMode: 'current', maxSpindle: 1000 });
  assert(aAfterB === baselineA, 'compiling job B before job A does not change job A output');

  const interleaved = await collectInterleaved(
    { ...jobA, options: { startMode: 'current', maxSpindle: 1000 } },
    { ...jobB, options: { startMode: 'absolute', maxSpindle: 255 } },
  );
  assert(interleaved.a === baselineA, 'overlapping compile A keeps its own relative position and modal state');
  assert(interleaved.b === baselineB, 'overlapping compile B keeps its own absolute position and S-value state');

  assert(/G1\b[^\n]*\bS500\b/.test(baselineA), 'job A uses its per-run max spindle value for 50% burn power');
  assert(/G1\b[^\n]*\bS204\b/.test(baselineB), 'job B uses its per-run max spindle value for 80% burn power');
  assert(/G91/.test(baselineA) && /G1 X10\.000/.test(baselineA), 'relative job emits relative deltas from its own run context');
  assert(/G90/.test(baselineB) && /G1 X10\.000 Y3\.000/.test(baselineB), 'absolute job emits absolute positions from its own run context');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
