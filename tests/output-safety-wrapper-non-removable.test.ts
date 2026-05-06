/**
 * T2-14: non-removable G-code safety wrapper. Pre-T2-14 a custom
 * `gcodeHeaderTemplate` REPLACED the default header entirely — a
 * template author who omitted G21 / G90/G91 / M5 silently produced
 * unsafe job start. The validator (T2-5) catches missing M5 in
 * footer; T1-26 appends M5 at send time. T2-14 is the structural
 * fix: safety baseline is emitted before any template content in
 * the header and after any template content in the footer, never
 * replaceable by user-supplied templates.
 *
 * Run: npx tsx tests/output-safety-wrapper-non-removable.test.ts
 */
import { compileJob } from '../src/core/job/JobCompiler';
import { createBlankProfile, saveDeviceProfile, setActiveProfileId } from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { type RectGeometry, type SceneObject } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';
import { TemplateValidationError } from '../src/core/output/Output';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';

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
  const scene = createScene(400, 300, 'T2-14');
  const layer = createLayer(0, 'cut', 'Cut');
  layer.settings.speed = 6000;
  layer.settings.power = { min: 20, max: 80 };
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const geom: RectGeometry = { type: 'rect', x: 10, y: 10, width: 50, height: 50, cornerRadius: 0 };
  const obj: SceneObject = {
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
  };
  scene.objects = [obj];
  return scene;
}

function indexOfFirst(haystack: string[], pattern: RegExp): number {
  for (let i = 0; i < haystack.length; i++) if (pattern.test(haystack[i])) return i;
  return -1;
}

console.log('\n=== T2-14 non-removable safety wrapper ===\n');

void (async () => {
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];

  const profile = createBlankProfile('T2-14-test');
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  // 1. Empty templates (default GrblOutputStrategy) → safety header lines
  //    appear in canonical order at the top of the file.
  {
    const scene = makeRectScene();
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const strategy = new GrblOutputStrategy();
    const plan = { id: 'p', jobId: job.id, createdAt: '', operations: [], stats: {
      totalDistanceMm: 0, rapidDistanceMm: 0, cutDistanceMm: 0, estimatedTimeSeconds: 0,
      moveCount: 0, operationCount: 0, passCount: 0,
    }, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
    const out = strategy.generate(plan, job, { startMode: 'absolute', returnPosition: null });
    const text = out.text ?? '';
    const lines = text.split('\n');
    const idxG21 = indexOfFirst(lines, /^G21\b/);
    const idxG90 = indexOfFirst(lines, /^G90\b/);
    const idxM5 = indexOfFirst(lines, /^M5\b/);
    assert(idxG21 >= 0 && idxG21 < idxG90,
      `default header: G21 before G90 (G21@${idxG21}, G90@${idxG90})`);
    assert(idxG90 < idxM5,
      `default header: G90 before M5 (G90@${idxG90}, M5@${idxM5})`);
    assert(/T2-14 safety baseline/.test(text),
      `default header: safety baseline marker present`);
  }

  // 2. Custom header template that omits G21/G90/M5 → safety baseline still
  //    appears before the template content
  {
    const scene = makeRectScene();
    // Inject template via direct strategy call (compileGcode doesn't
    // expose template options through to the strategy in this test
    // shape, so use the strategy directly)
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const strategy = new GrblOutputStrategy();
    // Build a minimal Plan with no operations so we just exercise header/footer
    const plan = { id: 'p', jobId: job.id, createdAt: '', operations: [], stats: {
      totalDistanceMm: 0, rapidDistanceMm: 0, cutDistanceMm: 0, estimatedTimeSeconds: 0,
      moveCount: 0, operationCount: 0, passCount: 0,
    }, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
    const out = strategy.generate(plan, job, {
      startMode: 'absolute',
      gcodeHeaderTemplate: '; my header\n; only my comment',
      returnPosition: null,
    });
    const text = out.text ?? '';
    const lines = text.split('\n');
    const idxSafetyG21 = indexOfFirst(lines, /^G21 ; T2-14 safety baseline/);
    const idxTemplateComment = indexOfFirst(lines, /^; my header$/);
    assert(idxSafetyG21 >= 0,
      `omit-template: safety G21 still emitted (got idx=${idxSafetyG21})`);
    assert(idxSafetyG21 < idxTemplateComment,
      `omit-template: safety baseline appears BEFORE template content (G21@${idxSafetyG21}, template@${idxTemplateComment})`);
  }

  // 3. Malicious template that emits M3 S100 → safety M5 still fires BEFORE
  //    the malicious M3 (so the laser-on doesn't go before the safety reset).
  //    Validator should catch the M3 separately at preflight; this is the
  //    runtime structural guarantee.
  {
    const scene = makeRectScene();
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const strategy = new GrblOutputStrategy();
    const plan = { id: 'p', jobId: job.id, createdAt: '', operations: [], stats: {
      totalDistanceMm: 0, rapidDistanceMm: 0, cutDistanceMm: 0, estimatedTimeSeconds: 0,
      moveCount: 0, operationCount: 0, passCount: 0,
    }, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
    let threwTemplateError = false;
    try {
      strategy.generate(plan, job, {
        startMode: 'absolute',
        gcodeHeaderTemplate: 'M3 S100 ; malicious laser-on in template',
        returnPosition: null,
      });
    } catch (error) {
      threwTemplateError = error instanceof TemplateValidationError;
    }
    assert(threwTemplateError,
      `malicious template: output generation rejects unsafe laser-on template`);
  }

  // 4. Custom end gcode → safety footer (M5 + M2) still last
  {
    const scene = makeRectScene();
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const strategy = new GrblOutputStrategy();
    const plan = { id: 'p', jobId: job.id, createdAt: '', operations: [], stats: {
      totalDistanceMm: 0, rapidDistanceMm: 0, cutDistanceMm: 0, estimatedTimeSeconds: 0,
      moveCount: 0, operationCount: 0, passCount: 0,
    }, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
    const out = strategy.generate(plan, job, {
      startMode: 'absolute',
      customEndGcode: 'M5\n; my custom end',
      returnPosition: null,
    });
    const text = out.text ?? '';
    const lines = text.split('\n').filter(l => l.length > 0);
    const lastLine = lines[lines.length - 1];
    const secondLastWithMotion = lines[lines.length - 2];
    assert(/^M2 .*T2-14 safety baseline/.test(lastLine),
      `customEnd: M2 safety baseline is the LAST line (got "${lastLine}")`);
    assert(/^M5 /.test(secondLastWithMotion) ||
      lines.slice(-3).some(l => /^M5 /.test(l)),
      `customEnd: M5 safety baseline appears in the trailing lines (last 3: ${lines.slice(-3).join(' / ')})`);
  }

  // 5. Footer template that omits M5/M2 → safety footer still appears at end.
  //    There can be a header-side M5 (safety baseline at start) earlier in
  //    the file; we look at LAST occurrences here, not first.
  {
    const scene = makeRectScene();
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const strategy = new GrblOutputStrategy();
    const plan = { id: 'p', jobId: job.id, createdAt: '', operations: [], stats: {
      totalDistanceMm: 0, rapidDistanceMm: 0, cutDistanceMm: 0, estimatedTimeSeconds: 0,
      moveCount: 0, operationCount: 0, passCount: 0,
    }, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
    const out = strategy.generate(plan, job, {
      startMode: 'absolute',
      gcodeFooterTemplate: 'M5\n; just a comment, no M2',
      returnPosition: null,
    });
    const text = out.text ?? '';
    const lines = text.split('\n').filter(l => l.length > 0);
    const idxTemplate = lines.findIndex(l => /^; just a comment/.test(l));
    // Find the LAST M5 / M2 (the safety footer ones)
    let idxLastM5 = -1, idxLastM2 = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^M5 .*laser off at end/.test(lines[i])) idxLastM5 = i;
      if (/^M2 .*program end/.test(lines[i])) idxLastM2 = i;
    }
    assert(idxTemplate >= 0 && idxLastM5 > idxTemplate && idxLastM2 > idxLastM5,
      `omit-footer-template: safety M5 + M2 appear AFTER the template (template@${idxTemplate}, M5@${idxLastM5}, M2@${idxLastM2})`);
    assert(idxLastM2 === lines.length - 1,
      `omit-footer-template: M2 is the very last non-empty line (got idx=${idxLastM2}, lines=${lines.length})`);
  }

  // 6. Relative startMode (Head): safety header includes G91, footer
  //    includes G90 restore.
  {
    const scene = makeRectScene();
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const strategy = new GrblOutputStrategy();
    const plan = { id: 'p', jobId: job.id, createdAt: '', operations: [], stats: {
      totalDistanceMm: 0, rapidDistanceMm: 0, cutDistanceMm: 0, estimatedTimeSeconds: 0,
      moveCount: 0, operationCount: 0, passCount: 0,
    }, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
    const out = strategy.generate(plan, job, {
      startMode: 'current',
      returnPosition: null,
    });
    const text = out.text ?? '';
    const lines = text.split('\n');
    const idxG91 = indexOfFirst(lines, /^G91 ; T2-14 safety baseline/);
    const idxG90Restore = indexOfFirst(lines, /^G90 ; restore absolute positioning/);
    assert(idxG91 >= 0,
      `relative mode: safety baseline emits G91 (got ${idxG91})`);
    assert(idxG90Restore > idxG91,
      `relative mode: G90 restore appears in footer (got G90@${idxG90Restore}, G91@${idxG91})`);
  }

  // 7. Source-level pin
  {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, '../src/core/output/Output.ts'), 'utf-8');
    assert(/T2-14: non-removable safety baseline/.test(src),
      'T2-14 safety-baseline marker in encodeHeader');
    assert(/T2-14: non-removable safety footer/.test(src),
      'T2-14 safety-footer marker in encodeFooter');
    assert(/safetyHeader: string\[\]|const safetyHeader = \[/.test(src),
      'safetyHeader array declared in encodeHeader');
    assert(/const safetyFooter: string\[\] = \[\];?|safetyFooter\.push/.test(src),
      'safetyFooter array constructed in encodeFooter');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => { console.error(e); process.exit(1); });
