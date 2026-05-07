/**
 * T2-17 follow-up: G-code output generation progress and cancellation.
 *
 * Run: npx tsx tests/output-progress-cancel.test.ts
 */
import { type Job } from '../src/core/job/Job';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';
import { type GcodeOutputProgress } from '../src/core/output/GcodeOrigin';
import { type PlannedOperation, type Plan } from '../src/core/plan/Plan';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  OK ${m}`);
  } else {
    failed++;
    console.error(`  FAIL ${m}`);
  }
}

function makeJobAndPlan(moveCount: number): { job: Job; plan: Plan } {
  const bounds = { minX: 0, minY: 0, maxX: moveCount, maxY: 0 };
  const job = {
    id: 'output-progress-job',
    name: 'Output Progress',
    operations: [{
      id: 'op-1',
      layerId: 'layer-1',
      layerName: 'Cut',
      layerColor: '#f00',
      order: 0,
      type: 'cut',
      settings: { passes: 1 },
      geometry: { type: 'vector', paths: [] },
      bounds,
    }],
    bounds,
    metadata: { objectCount: 1, layerCount: 1 },
  } as unknown as Job;

  const moves: PlannedOperation['moves'] = [];
  for (let i = 0; i < moveCount; i++) {
    moves.push({
      type: 'linear',
      to: { x: i + 1, y: 0 },
      power: 50,
      speed: 1000,
      sourceObjectIds: ['obj-1'],
    });
  }

  const plan = {
    id: 'output-progress-plan',
    jobId: job.id,
    createdAt: '2024-01-01T00:00:00.000Z',
    operations: [{
      operationId: 'op-1',
      layerName: 'Cut',
      passIndex: 0,
      moves,
    }],
    stats: {
      totalDistanceMm: moveCount,
      rapidDistanceMm: 0,
      cutDistanceMm: moveCount,
      estimatedTimeSeconds: moveCount,
      moveCount,
      operationCount: 1,
      passCount: 1,
    },
    bounds,
  } as Plan;

  return { job, plan };
}

console.log('\n=== T2-17 output generation progress + cancel ===\n');

// 1. Output generation emits move-level progress while producing G-code.
{
  const strategy = new GrblOutputStrategy();
  const { job, plan } = makeJobAndPlan(6);
  const events: GcodeOutputProgress[] = [];
  const output = strategy.generate(plan, job, {
    startMode: 'absolute',
    maxSpindle: 1000,
    returnPosition: null,
    onProgress: (event) => events.push(event),
  });

  assert(typeof output.text === 'string' && output.text.length > 0,
    'generate still produces G-code text');
  assert(events.length >= 6,
    `output generation reports each move (got ${events.length})`);
  assert(events.some(e => e.fraction > 0 && e.fraction < 1),
    `output progress emits intermediate fractions (got [${events.map(e => e.fraction.toFixed(2)).join(', ')}])`);
  assert(events[events.length - 1]?.fraction === 1,
    `output progress reaches 1 (got ${events[events.length - 1]?.fraction})`);
}

// 2. A pre-aborted signal stops before output generation emits text.
{
  const strategy = new GrblOutputStrategy();
  const { job, plan } = makeJobAndPlan(6);
  const ac = new AbortController();
  ac.abort();
  let threw = false;
  let isAbort = false;
  try {
    strategy.generate(plan, job, {
      startMode: 'absolute',
      maxSpindle: 1000,
      returnPosition: null,
      signal: ac.signal,
    });
  } catch (e) {
    threw = true;
    isAbort = e instanceof DOMException && e.name === 'AbortError';
  }
  assert(threw && isAbort,
    `pre-aborted output generation throws AbortError (threw=${threw}, isAbort=${isAbort})`);
}

// 3. Aborting from the progress callback stops before every move is emitted.
{
  const strategy = new GrblOutputStrategy();
  const { job, plan } = makeJobAndPlan(20);
  const ac = new AbortController();
  const events: GcodeOutputProgress[] = [];
  let threw = false;
  let isAbort = false;
  try {
    strategy.generate(plan, job, {
      startMode: 'absolute',
      maxSpindle: 1000,
      returnPosition: null,
      signal: ac.signal,
      onProgress: (event) => {
        events.push(event);
        if (event.completedMoves >= 3) ac.abort();
      },
    });
  } catch (e) {
    threw = true;
    isAbort = e instanceof DOMException && e.name === 'AbortError';
  }
  assert(events.length > 0 && events.length < 20,
    `mid-output abort stops before every move reports progress (got ${events.length})`);
  assert(threw && isAbort,
    `mid-output abort throws AbortError (threw=${threw}, isAbort=${isAbort})`);
}

// 4. Source-level pin.
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outputSrc = fs.readFileSync(path.resolve(here, '../src/core/output/Output.ts'), 'utf-8');
  const optionsSrc = fs.readFileSync(path.resolve(here, '../src/core/output/GcodeOrigin.ts'), 'utf-8');
  assert(/export interface GcodeOutputProgress/.test(optionsSrc),
    'GcodeOutputProgress interface is exported');
  assert(/onProgress\?: \(event: GcodeOutputProgress\) => void/.test(optionsSrc),
    'GcodeGenerateOptions exposes onProgress');
  assert(/throwIfOutputAborted/.test(outputSrc),
    'output generation has explicit abort checkpoints');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
