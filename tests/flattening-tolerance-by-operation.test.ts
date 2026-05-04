/**
 * T1-38: SVG-imported path geometry uses operation-aware flattening tolerance.
 * Pre-T1-38 the default was 0.5mm which produced visibly faceted curves on
 * small or detailed work (a 20mm circle came out as a 16-sided polygon).
 *
 * Tolerances:
 *   cut    : 0.05mm  (visible workpiece edge)
 *   score  : 0.05mm  (visible engraved line)
 *   engrave: 0.03mm  (fills hug boundary; faceting telegraphs as ringing)
 *   raster : 0.5mm   (never hit on this code path; defined for completeness)
 *
 * Run: npx tsx tests/flattening-tolerance-by-operation.test.ts
 */
import {
  geometryToPoints,
  FLATTEN_TOLERANCE_BY_OPERATION,
} from '../src/core/job/JobCompiler';
import type { Geometry } from '../src/core/scene/SceneObject';

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

console.log('\n=== T1-38 operation-aware flattening tolerance ===\n');

async function run(): Promise<void> {

// Build a single quarter-circle cubic bézier as an SVG-style path.
// The curve approximates a 20mm-radius arc from (20, 0) to (0, 20)
// using the canonical cubic Bezier coefficient (4/3) * tan(π/8) ≈ 0.5523
// for a quarter-circle approximation.
function quarterCirclePathGeom(radius: number): Geometry {
  const k = 0.5523 * radius;
  return {
    type: 'path',
    subPaths: [{
      segments: [
        { type: 'move', to: { x: radius, y: 0 } },
        { type: 'cubic', cp1: { x: radius, y: k }, cp2: { x: k, y: radius }, to: { x: 0, y: radius } },
      ],
      closed: false,
    }],
  } as unknown as Geometry;
}

// ── 1. Tolerance constants exposed and shaped per spec ──
{
  assert(FLATTEN_TOLERANCE_BY_OPERATION.cut === 0.05, 'cut tolerance = 0.05mm');
  assert(FLATTEN_TOLERANCE_BY_OPERATION.score === 0.05, 'score tolerance = 0.05mm');
  assert(FLATTEN_TOLERANCE_BY_OPERATION.engrave === 0.03, 'engrave tolerance = 0.03mm');
  assert(FLATTEN_TOLERANCE_BY_OPERATION.raster === 0.5, 'raster tolerance = 0.5mm (placeholder for unused path)');
}

// ── 2. Cut at 0.05mm produces noticeably more points than the legacy 0.5mm ──
{
  const geom = quarterCirclePathGeom(20);
  const cutGroups = geometryToPoints(geom, 'cut');
  const cutPoints = cutGroups[0]?.points.length ?? 0;
  // Legacy default was 0.5mm; quarter-circle radius=20mm produces ~6-8 points.
  // T1-38 cut tolerance 0.05mm should produce noticeably more than that.
  assert(cutPoints >= 12,
    `cut on 20mm quarter-circle produces tight flattening (got ${cutPoints} points; expect ≥12)`);
}

// ── 3. Engrave (0.03mm) is tighter than cut (0.05mm), which is tighter than raster (0.5mm) ──
{
  const geom = quarterCirclePathGeom(20);
  const engravePoints = geometryToPoints(geom, 'engrave')[0]?.points.length ?? 0;
  const cutPoints = geometryToPoints(geom, 'cut')[0]?.points.length ?? 0;
  const rasterPoints = geometryToPoints(geom, 'raster')[0]?.points.length ?? 0;

  assert(engravePoints >= cutPoints,
    `engrave is at least as tight as cut (engrave=${engravePoints}, cut=${cutPoints})`);
  assert(cutPoints > rasterPoints,
    `cut tighter than raster (cut=${cutPoints}, raster=${rasterPoints})`);
}

// ── 4. Default operationType (when omitted) is 'cut' — preserves the new
//       tight default rather than the pre-T1-38 0.5mm legacy ──
{
  const geom = quarterCirclePathGeom(20);
  const defaulted = geometryToPoints(geom)[0]?.points.length ?? 0;
  const cutPoints = geometryToPoints(geom, 'cut')[0]?.points.length ?? 0;
  assert(defaulted === cutPoints,
    `geometryToPoints() with no operationType defaults to cut tolerance (default=${defaulted}, cut=${cutPoints})`);
}

// ── 5. Non-path geometry (rect) is unaffected by operationType ──
//     Rectangles produce a fixed 4-point polygon regardless.
{
  const rectGeom: Geometry = {
    type: 'rect', x: 0, y: 0, width: 50, height: 30, cornerRadius: 0,
  } as unknown as Geometry;
  const cutPts = geometryToPoints(rectGeom, 'cut')[0]?.points.length ?? 0;
  const engravePts = geometryToPoints(rectGeom, 'engrave')[0]?.points.length ?? 0;
  assert(cutPts === 4 && engravePts === 4,
    `rect geometry produces 4 points regardless of operationType (cut=${cutPts}, engrave=${engravePts})`);
}

// ── 6. Source-level pin: T1-38 marker + tolerance constants + threading ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/core/job/JobCompiler.ts'),
    'utf-8',
  );

  assert(/T1-38/.test(src), 'T1-38 marker present in JobCompiler.ts');
  assert(/FLATTEN_TOLERANCE_BY_OPERATION:\s*Record<OperationType, number>/.test(src),
    'FLATTEN_TOLERANCE_BY_OPERATION constant declared with proper type');
  assert(
    /flattenObject\(\s*obj: SceneObject,\s*operationType: OperationType,/.test(src),
    'flattenObject signature accepts operationType',
  );
  assert(
    /geometryToPoints\(\s*geom: Geometry,\s*operationType: OperationType = 'cut',\s*\)/.test(src),
    "geometryToPoints signature defaults operationType to 'cut'",
  );
  // OLD shape - hardcoded 0.5mm in the path branch with the comment
  // about "default 0.5mm tolerance is fine" - is gone.
  assert(
    !/default 0\.5mm tolerance is fine/.test(src),
    'OLD "default 0.5mm tolerance is fine" comment removed',
  );
  assert(
    /subPathToPoints\(sub\.segments, tolerance\)/.test(src),
    'path branch passes operation-aware tolerance to subPathToPoints',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
