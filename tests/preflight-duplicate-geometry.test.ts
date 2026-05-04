/**
 * T2-16: duplicate / overlap path detection in preflight.
 *
 * Real-world failure mode: SVG imports / paste-twice / multiple-import
 * workflows leave stacked copies of the same shape on the canvas.
 * Without detection, the controller burns each duplicate independently
 * — twice the time, twice the deposited power, charred edges.
 *
 * Severity is `warning` not `error` — sometimes users intentionally
 * stack shapes (double cuts, power doubling). Block would be too
 * aggressive; warning surfaces the suspicion and the user confirms.
 *
 * Run: npx tsx tests/preflight-duplicate-geometry.test.ts
 */
import {
  runPreflight,
  PREFLIGHT_CODES,
  type PreflightContext,
} from '../src/core/preflight/Preflight';
import { fingerprintObject } from '../src/core/preflight/rules/DuplicateGeometryPreflight';
import { createBlankProfile } from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { createRect, createEllipse } from '../src/core/scene/SceneObject';
import { defaultLaserSettings } from '../src/core/scene/Layer';
import type { Scene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';
import type { Layer } from '../src/core/scene/Layer';

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

console.log('\n=== T2-16 duplicate geometry preflight ===\n');

async function run(): Promise<void> {

function sceneWith(objs: SceneObject[]): Scene {
  const s = createScene(300, 200, 't2-16 test');
  const layer: Layer = {
    id: 'L1', name: 'Cut', color: '#000', visible: true, locked: false,
    output: true, order: 0, settings: defaultLaserSettings('cut'),
  };
  s.layers = [layer];
  s.objects = objs.map(o => ({ ...o, layerId: 'L1' }));
  return s;
}

function ctxFor(scene: Scene): PreflightContext {
  const profile = createBlankProfile('T2-16');
  profile.maxSpindle = 1000;
  return {
    scene,
    profile,
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 300,
    preflightBedHeightMm: 200,
    connectedToMachine: false,
    hasGcode: false,
    machinePlanBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    liveMachineInfo: {},
  };
}

function findDup(scene: Scene): { count: number; first?: string } {
  const r = runPreflight(ctxFor(scene));
  const issues = r.filter(x => x.code === PREFLIGHT_CODES.GEOMETRY_DUPLICATE);
  return { count: issues.length, first: issues[0]?.message };
}

// ── 1. Two identical rects at the same position → 1 warning ──
{
  const a = createRect('L1', 10, 10, 50, 50, 'a');
  const b = createRect('L1', 10, 10, 50, 50, 'b');
  const r = findDup(sceneWith([a, b]));
  assert(r.count === 1, `2 stacked rects → 1 GEOMETRY_DUPLICATE warning (got ${r.count})`);
  assert(/2 potentially duplicate/i.test(r.first ?? ''),
    'message says "2 potentially duplicate" objects');
  assert(/Inspect the canvas/i.test(r.first ?? ''),
    'message names "Inspect the canvas" remediation');
}

// ── 2. Two rects at different positions → no warning ──
{
  const a = createRect('L1', 10, 10, 50, 50, 'a');
  const b = createRect('L1', 100, 10, 50, 50, 'b');
  const r = findDup(sceneWith([a, b]));
  assert(r.count === 0, 'rects at different positions → no warning');
}

// ── 3. Two same-shape rects at same position with different rotation
//      → no warning (different transform.a/b/c/d) ──
{
  const a = createRect('L1', 10, 10, 50, 50, 'a');
  const b = createRect('L1', 10, 10, 50, 50, 'b');
  // Rotate b by 45° in place (modify transform a/b/c/d).
  const cos45 = Math.cos(Math.PI / 4);
  const sin45 = Math.sin(Math.PI / 4);
  b.transform = { a: cos45, b: sin45, c: -sin45, d: cos45, tx: b.transform.tx, ty: b.transform.ty };
  const r = findDup(sceneWith([a, b]));
  assert(r.count === 0,
    'same-shape rects with different rotation → no warning (transform.a/b differs)');
}

// ── 4. Three duplicates of the same shape → 1 warning listing the count ──
{
  const a = createRect('L1', 10, 10, 50, 50, 'a');
  const b = createRect('L1', 10, 10, 50, 50, 'b');
  const c = createRect('L1', 10, 10, 50, 50, 'c');
  const r = findDup(sceneWith([a, b, c]));
  assert(r.count === 1, '3 stacked → still 1 warning (cluster, not pairs)');
  assert(/3 potentially duplicate/i.test(r.first ?? ''),
    `message says "3 potentially duplicate" (got: ${r.first})`);
}

// ── 5. 5 duplicates → 1 warning with "+2 more" suffix ──
{
  const objs = Array.from({ length: 5 }, () => createRect('L1', 10, 10, 50, 50));
  const r = findDup(sceneWith(objs));
  assert(r.count === 1, '5 stacked → 1 warning');
  assert(/\+2 more/.test(r.first ?? ''),
    `message includes "+2 more" suffix when cluster > 3 ids (got: ${r.first})`);
}

// ── 6. Different geometry types at same transform → no warning
//      (a 50x50 rect at 10,10 vs an ellipse rx=25,ry=25 at 10,10) ──
{
  const a = createRect('L1', 10, 10, 50, 50, 'rect');
  const b = createEllipse('L1', 35, 35, 25, 25, 'ellipse');
  const r = findDup(sceneWith([a, b]));
  assert(r.count === 0, 'rect vs ellipse at overlapping bounds → no warning (different types)');
}

// ── 7. Hidden duplicate is ignored ──
{
  const a = createRect('L1', 10, 10, 50, 50, 'a');
  const b = createRect('L1', 10, 10, 50, 50, 'b');
  b.visible = false;
  const r = findDup(sceneWith([a, b]));
  assert(r.count === 0, 'hidden duplicate is ignored (visible=false skipped)');
}

// ── 8. Layer-with-output:false suppresses the warning ──
{
  const a = createRect('L1', 10, 10, 50, 50, 'a');
  const b = createRect('L1', 10, 10, 50, 50, 'b');
  const scene = sceneWith([a, b]);
  scene.layers[0].output = false;
  const r = findDup(scene);
  assert(r.count === 0, 'layer.output === false suppresses the warning (no burn happens)');
}

// ── 9. Duplicates on different layers — both visible + output → warning still fires
//      (the burn still happens twice; layer separation doesn't change that) ──
{
  const a = createRect('L1', 10, 10, 50, 50, 'a');
  const b = createRect('L1', 10, 10, 50, 50, 'b');
  // Both objects on same layer L1 (since the helper assigns L1).
  // Add a second layer to confirm the rule walks all visible objects regardless.
  const scene = sceneWith([a, b]);
  scene.layers.push({
    id: 'L2', name: 'Score', color: '#888', visible: true, locked: false,
    output: true, order: 1, settings: defaultLaserSettings('score'),
  });
  const r = findDup(scene);
  assert(r.count === 1, 'duplicates fire warning regardless of which output layer');
}

// ── 10. fingerprintObject is exported and stable for round-trip ──
{
  const a = createRect('L1', 10, 10, 50, 50, 'a');
  const fp1 = fingerprintObject(a);
  const fp2 = fingerprintObject(a);
  assert(fp1 === fp2, 'fingerprintObject is deterministic — same object → same fingerprint');
}

// ── 11. fingerprintObject distinguishes rect from rect-with-cornerRadius ──
{
  const a = createRect('L1', 10, 10, 50, 50, 'a');
  const b = createRect('L1', 10, 10, 50, 50, 'b');
  // Add corner radius via direct geometry mutation (createRect default = 0).
  if (b.geometry.type === 'rect') {
    b.geometry.cornerRadius = 5;
  }
  assert(fingerprintObject(a) !== fingerprintObject(b),
    'rect vs rect-with-cornerRadius produce different fingerprints');
}

// ── 12. Source-level pin: T2-16 marker + integration into runPreflight ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));

  const ruleSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/rules/DuplicateGeometryPreflight.ts'),
    'utf-8',
  );
  assert(/T2-16/.test(ruleSrc), 'T2-16 marker present in DuplicateGeometryPreflight.ts');
  assert(/export function fingerprintObject/.test(ruleSrc),
    'fingerprintObject exported');
  assert(/export function runDuplicateGeometryChecks/.test(ruleSrc),
    'runDuplicateGeometryChecks exported');

  const preflightSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/Preflight.ts'),
    'utf-8',
  );
  assert(/GEOMETRY_DUPLICATE:\s*'GEOMETRY_DUPLICATE'/.test(preflightSrc),
    'GEOMETRY_DUPLICATE preflight code constant declared');
  assert(/runDuplicateGeometryChecks\(ctx, results\)/.test(preflightSrc),
    'runPreflight orchestrator calls runDuplicateGeometryChecks');
  assert(/import \{ runDuplicateGeometryChecks \}/.test(preflightSrc),
    'runDuplicateGeometryChecks imported in Preflight.ts');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
