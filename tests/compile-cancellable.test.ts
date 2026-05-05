/**
 * T2-17: AbortSignal + progress callback through compileGcode.
 * Pre-T2-17 the compile was uncancellable internally — once started,
 * every loop ran to completion. The MVP shipped here adds phase-
 * boundary checkpoints (5 phases: text-expansion, compile-job, plan,
 * transform, output); deep-loop instrumentation in JobCompiler /
 * PlanOptimizer / Output is filed as T2-17-followup.
 *
 * Run: npx tsx tests/compile-cancellable.test.ts
 */
import { compileGcode, type CompileProgress } from '../src/app/PipelineService';
import { createBlankProfile, saveDeviceProfile, setActiveProfileId, getActiveProfile } from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { type RectGeometry, type SceneObject } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

const memoryStore: Record<string, string> = {};
function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() { return Object.keys(memoryStore).length; },
    clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
    getItem: (k: string) => Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null,
    key: (i: number) => Object.keys(memoryStore)[i] ?? null,
    removeItem: (k: string) => { delete memoryStore[k]; },
    setItem: (k: string, v: string) => { memoryStore[k] = v; },
  } as Storage;
}

function makeRectScene(): ReturnType<typeof createScene> {
  const scene = createScene(400, 300, 'T2-17');
  const layer = createLayer(0, 'cut', 'Cut');
  layer.settings.speed = 1500;
  layer.settings.power = { min: 20, max: 80 };
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const geom: RectGeometry = { type: 'rect', x: 10, y: 10, width: 50, height: 50, cornerRadius: 0 };
  scene.objects = [{
    id: generateId(),
    type: 'rect',
    name: 'r',
    layerId: layer.id,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  }];
  return scene;
}

console.log('\n=== T2-17 compile cancellable + progress ===\n');

void (async () => {
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];

  const profile = createBlankProfile('T2-17-test');
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  // 1. Backward-compat: existing callers (no `opts`) still work
  {
    const scene = makeRectScene();
    const result = await compileGcode(scene, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile());
    assert(result != null && typeof result.gcode === 'string' && result.gcode.length > 0,
      'no opts: compileGcode produces gcode (backward-compat preserved)');
  }

  // 2. Progress callback fires at every phase boundary with monotonically-
  //    increasing overallFraction
  {
    const scene = makeRectScene();
    const events: CompileProgress[] = [];
    const result = await compileGcode(scene, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile(), {
      onProgress: (e) => events.push(e),
    });
    assert(result != null, 'progress callback: compile still succeeds');
    assert(events.length >= 5,
      `progress: at least 5 events fired (5 phases × ≥1 each; got ${events.length})`);

    const phases = new Set(events.map(e => e.phase));
    for (const expected of ['text-expansion', 'compile-job', 'plan', 'transform', 'output']) {
      assert(phases.has(expected as CompileProgress['phase']),
        `progress: phase '${expected}' fired at least once`);
    }

    // Monotonic non-decreasing overallFraction
    let monotonic = true;
    for (let i = 1; i < events.length; i++) {
      if (events[i].overallFraction < events[i - 1].overallFraction - 1e-9) {
        monotonic = false;
        break;
      }
    }
    assert(monotonic,
      `progress: overallFraction monotonically non-decreasing (got [${events.map(e => e.overallFraction.toFixed(2)).join(', ')}])`);

    // First event near 0, last event near 1
    assert(events[0].overallFraction < 0.2,
      `progress: first overallFraction starts low (got ${events[0].overallFraction.toFixed(2)})`);
    assert(events[events.length - 1].overallFraction >= 0.99,
      `progress: last overallFraction reaches 1 (got ${events[events.length - 1].overallFraction.toFixed(2)})`);
  }

  // 3. AbortSignal aborted BEFORE compile starts → throws AbortError
  //    immediately, no compile work done
  {
    const scene = makeRectScene();
    const ac = new AbortController();
    ac.abort();
    let threw = false;
    let isAbort = false;
    try {
      await compileGcode(scene, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile(), {
        signal: ac.signal,
      });
    } catch (e) {
      threw = true;
      isAbort = e instanceof DOMException && e.name === 'AbortError';
    }
    assert(threw && isAbort,
      `pre-aborted: compileGcode throws AbortError (threw=${threw}, isAbort=${isAbort})`);
  }

  // 4. AbortSignal aborted MID-FLIGHT (between text-expansion and
  //    compile-job) → throws AbortError, doesn't return a result
  {
    const scene = makeRectScene();
    const ac = new AbortController();
    let firstPhaseSeen = false;
    let threw = false;
    let isAbort = false;
    try {
      await compileGcode(scene, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile(), {
        signal: ac.signal,
        onProgress: (e) => {
          if (e.phase === 'text-expansion' && e.fraction === 1 && !firstPhaseSeen) {
            firstPhaseSeen = true;
            ac.abort();
          }
        },
      });
    } catch (e) {
      threw = true;
      isAbort = e instanceof DOMException && e.name === 'AbortError';
    }
    assert(firstPhaseSeen,
      'mid-abort: text-expansion phase fired before abort');
    assert(threw && isAbort,
      `mid-abort: throws AbortError after text-expansion (threw=${threw}, isAbort=${isAbort})`);
  }

  // 5. Progress events declare known phases only (typesafe pin)
  {
    const scene = makeRectScene();
    const events: CompileProgress[] = [];
    await compileGcode(scene, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile(), {
      onProgress: (e) => events.push(e),
    });
    const validPhases = new Set(['text-expansion', 'compile-job', 'plan', 'transform', 'output']);
    let allValid = true;
    for (const e of events) {
      if (!validPhases.has(e.phase)) { allValid = false; break; }
    }
    assert(allValid,
      'progress events: every phase value is in the declared union');
  }

  // 6. Phase budgets sum to ~1.0 (sanity on the percentage allocation
  //    so the UI's progress bar reaches the end at compile success)
  {
    const scene = makeRectScene();
    const events: CompileProgress[] = [];
    await compileGcode(scene, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile(), {
      onProgress: (e) => events.push(e),
    });
    // Find the maximum overallFraction reported; it should be very close to 1.
    const maxOverall = events.reduce((m, e) => Math.max(m, e.overallFraction), 0);
    assert(Math.abs(maxOverall - 1) < 0.001,
      `phase budgets sum to 1 (max overallFraction=${maxOverall.toFixed(4)})`);
  }

  // 7. Source-level pin
  {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, '../src/app/PipelineService.ts'), 'utf-8');
    assert(/T2-17/.test(src), 'T2-17 marker in PipelineService.ts');
    assert(/export interface CompileOptions/.test(src),
      'CompileOptions interface exported');
    assert(/export interface CompileProgress/.test(src),
      'CompileProgress interface exported');
    for (const phase of ['text-expansion', 'compile-job', 'plan', 'transform', 'output']) {
      assert(src.includes(`'${phase}'`),
        `phase '${phase}' present in source`);
    }
    assert(/throwIfAborted\(opts\.signal\)/.test(src),
      'throwIfAborted invoked at every phase boundary');
    assert(/reportPhase\(opts/.test(src),
      'reportPhase invoked at every phase boundary');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => { console.error(e); process.exit(1); });
