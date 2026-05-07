/**
 * T2-17 follow-up: JobCompiler deep-loop progress and cancellation.
 *
 * Run: npx tsx tests/jobcompiler-progress-cancel.test.ts
 */
import { compileJob, type CompileJobProgress } from '../src/core/job/JobCompiler';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { type RectGeometry, type SceneObject } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';
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

function makeScene(objectCount: number): ReturnType<typeof createScene> {
  const scene = createScene(400, 300, 'T2-17 JobCompiler progress');
  const layer = createLayer(0, 'cut', 'Cut');
  layer.settings.speed = 1500;
  layer.settings.power = { min: 20, max: 80 };
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [];

  for (let i = 0; i < objectCount; i++) {
    const geom: RectGeometry = {
      type: 'rect',
      x: 10 + i * 4,
      y: 10,
      width: 2,
      height: 2,
      cornerRadius: 0,
    };
    const obj: SceneObject = {
      id: generateId(),
      type: 'rect',
      name: `r-${i}`,
      layerId: layer.id,
      parentId: null,
      transform: { ...IDENTITY_MATRIX },
      geometry: geom,
      visible: true,
      locked: false,
      powerScale: 1,
      _bounds: null,
      _worldTransform: null,
    };
    scene.objects.push(obj);
  }

  return scene;
}

console.log('\n=== T2-17 JobCompiler progress + cancel ===\n');

// 1. JobCompiler emits object-granular progress, not only pipeline phase
//    boundaries.
{
  const events: CompileJobProgress[] = [];
  const job = compileJob(makeScene(5), {
    onProgress: (event) => events.push(event),
  });

  assert(job.operations.length === 5,
    `compileJob still emits one optimized operation per object (got ${job.operations.length})`);
  assert(events.length >= 5,
    `compileJob reports progress for each object (got ${events.length})`);
  assert(events.some(e => e.fraction > 0 && e.fraction < 1),
    `compileJob emits intermediate fractions (got [${events.map(e => e.fraction.toFixed(2)).join(', ')}])`);
  assert(events[events.length - 1]?.fraction === 1,
    `compileJob final progress reaches 1 (got ${events[events.length - 1]?.fraction})`);

  let monotonic = true;
  for (let i = 1; i < events.length; i++) {
    if (events[i].fraction < events[i - 1].fraction - 1e-9) {
      monotonic = false;
      break;
    }
  }
  assert(monotonic,
    `compileJob progress is monotonic (got [${events.map(e => e.fraction.toFixed(2)).join(', ')}])`);
}

// 2. A signal aborted before compile starts stops the compiler immediately.
{
  const ac = new AbortController();
  ac.abort();
  let threw = false;
  let isAbort = false;
  try {
    compileJob(makeScene(5), { signal: ac.signal });
  } catch (e) {
    threw = true;
    isAbort = e instanceof DOMException && e.name === 'AbortError';
  }
  assert(threw && isAbort,
    `pre-aborted signal throws AbortError (threw=${threw}, isAbort=${isAbort})`);
}

// 3. A signal aborted from a progress callback stops before all objects are
//    compiled. This is the sync compiler's cooperative checkpoint; async UI
//    event-loop cancellation remains a worker/async pipeline follow-up.
{
  const ac = new AbortController();
  const events: CompileJobProgress[] = [];
  let threw = false;
  let isAbort = false;
  try {
    compileJob(makeScene(20), {
      signal: ac.signal,
      onProgress: (event) => {
        events.push(event);
        if (event.completedObjects >= 3) ac.abort();
      },
    });
  } catch (e) {
    threw = true;
    isAbort = e instanceof DOMException && e.name === 'AbortError';
  }
  assert(events.length > 0 && events.length < 20,
    `mid-compile abort stops before every object reports progress (got ${events.length})`);
  assert(threw && isAbort,
    `mid-compile abort throws AbortError (threw=${threw}, isAbort=${isAbort})`);
}

// 4. Source-level pin so T2-17 cannot silently fall back to phase-boundary-only
//    progress again.
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/core/job/JobCompiler.ts'), 'utf-8');
  assert(/export interface CompileJobProgress/.test(src),
    'CompileJobProgress interface is exported');
  assert(/onProgress\?: \(event: CompileJobProgress\) => void/.test(src),
    'CompileJobOptions exposes onProgress');
  assert(/throwIfCompileAborted/.test(src),
    'compileJob has explicit abort checkpoints');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
