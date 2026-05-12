/**
 * T2-23: determinism gate — same scene compiled N times must produce
 * byte-identical G-code (after stripping the wall-clock timestamp
 * line that the pipeline doesn't yet thread a deterministic clock
 * through). Pre-T2-23 nothing tested compile reproducibility, so any
 * latent non-determinism (Map iteration order over non-stable keys,
 * unstable tie-breaking in the path optimizer, async font-cache
 * timing, leaked Date.now()) could land silently.
 *
 * Builds on T2-18 (parser semantics) and T1-48 (deterministic
 * createdAt via injectable clock — currently exercised at the
 * strategy level; threaded through PipelineService is filed as
 * T2-23-followup).
 *
 * Run: npx tsx tests/determinism-gate.test.ts
 */
import { compileGcode } from '../src/app/PipelineService';
import { createBlankProfile, saveDeviceProfile, setActiveProfileId, getActiveProfile } from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import {
  type ImageGeometry,
  type RectGeometry,
  type EllipseGeometry,
  type SceneObject,
} from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX } from '../src/core/types';
import { makeRng } from './helpers/propertyTesting';

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

/**
 * Strip lines that are intentionally non-deterministic (timestamps,
 * version/id stamps). Everything else must compare byte-identical
 * across runs.
 *
 * Templates today emit `; Generated: {DATE} {TIME}` (see
 * `src/core/plan/GcodeTemplates.ts`); the original spec used
 * `; Date:`. Strip both — and `Version` / `Id` / `Time` — for
 * symmetry with `tests/e2e/helpers/compileToGcode.ts`. Without
 * this, a compile that crosses a wall-clock-second boundary
 * spuriously fails the gate (the actual T2-23 contract is about
 * algorithmic determinism, not the clock).
 */
function normalizeForDeterminism(gcode: string): string {
  return gcode
    .split('\n')
    .filter(l =>
      !/^;\s*Generated:/i.test(l) &&
      !/^;\s*Date:/i.test(l) &&
      !/^;\s*Time:/i.test(l) &&
      !/^;\s*Version:/i.test(l) &&
      !/^;\s*Id:/i.test(l),
    )
    .join('\n');
}

function findFirstDiff(a: string, b: string): { line: number; left: string; right: string } | null {
  const al = a.split('\n');
  const bl = b.split('\n');
  const max = Math.max(al.length, bl.length);
  for (let i = 0; i < max; i++) {
    const la = al[i] ?? '';
    const lb = bl[i] ?? '';
    if (la !== lb) return { line: i, left: la, right: lb };
  }
  return null;
}

function makeSeededId(rng: ReturnType<typeof makeRng>): string {
  // Use the property-testing RNG for deterministic IDs in this test
  return `obj-${rng.int(100000, 999999).toString(16)}`;
}

function makeNonTrivialScene(seed = 1): ReturnType<typeof createScene> {
  const rng = makeRng(seed);
  const scene = createScene(400, 300, 'T2-23-determinism');

  const cutLayer = createLayer(0, 'cut', 'Cut');
  cutLayer.settings.speed = 1500;
  cutLayer.settings.power = { min: 20, max: 80 };

  const engraveLayer = createLayer(1, 'engrave', 'Engrave');
  engraveLayer.settings.speed = 6000;
  engraveLayer.settings.power = { min: 10, max: 40 };
  engraveLayer.settings.fill = {
    ...engraveLayer.settings.fill,
    enabled: true,
    angle: 0,
    interval: 0.5,
    mode: 'line',
  };

  const rasterLayer = createLayer(2, 'image', 'Raster');
  rasterLayer.settings.speed = 6000;
  rasterLayer.settings.power = { min: 10, max: 70 };
  rasterLayer.settings.image.imageMode = 'threshold';
  rasterLayer.settings.image.imageThreshold = 128;

  scene.layers = [cutLayer, engraveLayer, rasterLayer];
  scene.activeLayerId = cutLayer.id;

  const objects: SceneObject[] = [];

  // Two cut rects
  for (let i = 0; i < 2; i++) {
    const x = 10 + i * 30, y = 20 + i * 10;
    const geom: RectGeometry = { type: 'rect', x: 0, y: 0, width: 20, height: 15, cornerRadius: 0 };
    objects.push({
      id: makeSeededId(rng),
      type: 'rect',
      name: `cut-rect-${i}`,
      layerId: cutLayer.id,
      parentId: null,
      transform: { ...IDENTITY_MATRIX, tx: x, ty: y },
      geometry: geom,
      visible: true,
      locked: false,
      powerScale: 1,
      _bounds: null,
      _worldTransform: null,
    });
  }

  // Engrave ellipse + rect. Keep these closed so the fill planner
  // exercises deterministic scanline output instead of rejecting an
  // open path as an invalid fill input.
  {
    const ell: EllipseGeometry = { type: 'ellipse', cx: 0, cy: 0, rx: 12, ry: 8 };
    objects.push({
      id: makeSeededId(rng), type: 'ellipse', name: 'engrave-ellipse',
      layerId: engraveLayer.id, parentId: null,
      transform: { ...IDENTITY_MATRIX, tx: 100, ty: 60 },
      geometry: ell, visible: true, locked: false, powerScale: 1,
      _bounds: null, _worldTransform: null,
    });
    const fillRect: RectGeometry = { type: 'rect', x: 0, y: 0, width: 25, height: 10, cornerRadius: 0 };
    objects.push({
      id: makeSeededId(rng), type: 'rect', name: 'engrave-rect',
      layerId: engraveLayer.id, parentId: null,
      transform: { ...IDENTITY_MATRIX, tx: 130, ty: 80 },
      geometry: fillRect, visible: true, locked: false, powerScale: 1,
      _bounds: null, _worldTransform: null,
    });
  }

  // Tiny raster (1bit threshold mode)
  {
    const W = 8, H = 4;
    const data = new Uint8Array(W * H).fill(255);
    for (let i = 0; i < W; i++) data[i] = 0; // first row burn
    data[W + 0] = 0; data[W + 4] = 0;        // second row dotted
    const geom: ImageGeometry = {
      type: 'image',
      src: 'data:image/png;base64,xx',
      originalWidth: W, originalHeight: H,
      cropX: 0, cropY: 0, cropWidth: W, cropHeight: H,
      grayscaleData: data,
      grayscaleWidth: W, grayscaleHeight: H,
    };
    objects.push({
      id: makeSeededId(rng), type: 'image', name: 'raster',
      layerId: rasterLayer.id, parentId: null,
      transform: { ...IDENTITY_MATRIX, tx: 200, ty: 200 },
      geometry: geom, visible: true, locked: false, powerScale: 1,
      _bounds: null, _worldTransform: null,
    });
  }

  scene.objects = objects;
  return scene;
}

console.log('\n=== T2-23 determinism gate ===\n');

void (async () => {
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];

  const profile = createBlankProfile('T2-23-test');
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  // 1. Same scene compiles 20× to byte-identical G-code (after stripping
  //    the wall-clock `; Date:` line, which the pipeline doesn't yet
  //    thread a deterministic clock through — filed as T2-23-followup).
  {
    const scene = makeNonTrivialScene(0xa1b2);
    const N = 20;
    const gcodes: string[] = [];
    let firstResult: Awaited<ReturnType<typeof compileGcode>> | null = null;
    for (let i = 0; i < N; i++) {
      const r = await compileGcode(scene, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile());
      if (i === 0) firstResult = r;
      gcodes.push(normalizeForDeterminism(r?.gcode ?? ''));
    }
    assert(gcodes[0].length > 0,
      `compile produced non-empty gcode (got ${gcodes[0].length} chars; r=${firstResult == null ? 'null' : `obj len=${firstResult.gcode?.length ?? 0}`})`);
    let allEqual = true;
    let firstDiff: { run: number; line: number; left: string; right: string } | null = null;
    for (let i = 1; i < N; i++) {
      if (gcodes[i] !== gcodes[0]) {
        allEqual = false;
        const d = findFirstDiff(gcodes[0], gcodes[i]);
        if (d) firstDiff = { run: i, ...d };
        break;
      }
    }
    assert(allEqual,
      firstDiff
        ? `20 runs byte-identical (failed at run ${firstDiff.run}, line ${firstDiff.line}: '${firstDiff.left}' vs '${firstDiff.right}')`
        : `20 runs byte-identical`);
  }

  // 2. Compile order independence: shuffling the scene.objects array
  //    must produce the same G-code after compile (the planner /
  //    optimizer must establish a canonical order before emission so
  //    the user-facing object list ordering doesn't leak into output).
  {
    const baseScene = makeNonTrivialScene(0xc0de);
    const reference = await compileGcode(baseScene, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile());
    const refText = normalizeForDeterminism(reference?.gcode ?? '');

    const TRIALS = 5;
    let allOrderInvariant = true;
    let failingTrial = -1;
    for (let trial = 0; trial < TRIALS; trial++) {
      const rng = makeRng(0x100 + trial);
      const shuffled: SceneObject[] = [...baseScene.objects];
      // Fisher-Yates shuffle
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const trialScene = { ...baseScene, objects: shuffled };
      const r = await compileGcode(trialScene, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile());
      const trialText = normalizeForDeterminism(r?.gcode ?? '');
      if (trialText !== refText) {
        allOrderInvariant = false;
        failingTrial = trial;
        break;
      }
    }
    assert(allOrderInvariant,
      allOrderInvariant
        ? `${TRIALS} shuffle trials all produce reference output`
        : `shuffle order invariance broken on trial ${failingTrial}`);
  }

  // 3. Two independently-generated scenes with the same seed produce
  //    the same gcode (sanity check on the deterministic generator
  //    itself; rules out the seed plumbing as a source of flake).
  {
    const a = makeNonTrivialScene(0x42);
    const b = makeNonTrivialScene(0x42);
    const ra = await compileGcode(a, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile());
    const rb = await compileGcode(b, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile());
    const at = normalizeForDeterminism(ra?.gcode ?? '');
    const bt = normalizeForDeterminism(rb?.gcode ?? '');
    assert(at === bt && at.length > 0,
      `same-seed regenerated scenes compile to identical output (lengths: A=${at.length}, B=${bt.length})`);
  }

  // 4. Determinism diagnosis: when a future regression makes runs
  //    diverge, `findFirstDiff` reports a useful pointer — pin its
  //    behavior on a synthetic mismatch so the failure path is
  //    self-tested.
  {
    const a = 'line0\nline1\nline2\nline3';
    const b = 'line0\nline1\nDIVERGED\nline3';
    const d = findFirstDiff(a, b);
    assert(d != null && d.line === 2 && d.right === 'DIVERGED',
      `findFirstDiff reports the right line + content (got ${JSON.stringify(d)})`);
    const sameDiff = findFirstDiff('xy', 'xy');
    assert(sameDiff == null, `findFirstDiff returns null for identical strings`);
  }

  // 5. Source-level pin: T1-48 clock injection still present in
  //    Output (the foundation T2-23 builds on); T2-23 marker in the
  //    test file documents the dependency.
  {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const outSrc = fs.readFileSync(path.resolve(here, '../src/core/output/Output.ts'), 'utf-8');
    assert(/options\?\.clock/.test(outSrc),
      'Output.ts retains T1-48 clock injection support (foundation for T2-23)');
    const testSrc = fs.readFileSync(path.resolve(here, 'determinism-gate.test.ts'), 'utf-8');
    assert(/T2-23/.test(testSrc), 'T2-23 marker in determinism-gate.test.ts');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => { console.error(e); process.exit(1); });
