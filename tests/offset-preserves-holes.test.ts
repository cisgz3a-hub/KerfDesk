/**
 * T1-36: kerf-compensation offset preserves holes.
 *
 * Pre-T1-36 `offsetObject` only processed `poly[0]` (outer ring); holes
 * were silently dropped. For a donut shape the inner hole stayed at
 * design size, so the laser kerf removed material from BOTH sides of
 * the inner edge → finished hole came out too small.
 *
 * `objectToPolygon` now groups subpaths by even-odd containment depth
 * so a compound path (outer + hole) becomes one polygon with two rings
 * instead of two single-ring polygons. `offsetObject` enforces canonical
 * winding (outer CCW, hole CW) and passes the whole polygon to
 * polygon-offset.
 *
 * Run: npx tsx tests/offset-preserves-holes.test.ts
 */
import { offsetObject } from '../src/geometry/OffsetPath';
import { objectToPolygon } from '../src/geometry/BooleanOps';
import type { PathGeometry, SceneObject, SubPath } from '../src/core/scene/SceneObject';
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

function squareSubPath(x: number, y: number, side: number, ccw = true): SubPath {
  // Build a closed square. CCW order: (x,y) → (x+s,y) → (x+s,y+s) → (x,y+s).
  // CW order reverses.
  const pts = ccw
    ? [[x, y], [x + side, y], [x + side, y + side], [x, y + side]]
    : [[x, y], [x, y + side], [x + side, y + side], [x + side, y]];
  return {
    closed: true,
    segments: [
      { type: 'move', to: { x: pts[0][0], y: pts[0][1] } },
      { type: 'line', to: { x: pts[1][0], y: pts[1][1] } },
      { type: 'line', to: { x: pts[2][0], y: pts[2][1] } },
      { type: 'line', to: { x: pts[3][0], y: pts[3][1] } },
      { type: 'close' },
    ],
  };
}

function makePathObject(subPaths: SubPath[]): SceneObject {
  const geom: PathGeometry = { type: 'path', subPaths };
  return {
    id: generateId(),
    type: 'path',
    name: 'p',
    layerId: 'l',
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function bbox(geom: PathGeometry): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sp of geom.subPaths) {
    for (const seg of sp.segments) {
      if (seg.type === 'move' || seg.type === 'line') {
        minX = Math.min(minX, seg.to.x);
        minY = Math.min(minY, seg.to.y);
        maxX = Math.max(maxX, seg.to.x);
        maxY = Math.max(maxY, seg.to.y);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

function subPathBounds(sp: SubPath): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of sp.segments) {
    if (seg.type === 'move' || seg.type === 'line') {
      minX = Math.min(minX, seg.to.x);
      minY = Math.min(minY, seg.to.y);
      maxX = Math.max(maxX, seg.to.x);
      maxY = Math.max(maxY, seg.to.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

console.log('\n=== T1-36 offset preserves holes ===\n');

void (async () => {

// 1. objectToPolygon: simple square produces a 1-polygon, 1-ring shape
{
  const obj = makePathObject([squareSubPath(0, 0, 50)]);
  const multi = objectToPolygon(obj);
  assert(multi != null && multi.length === 1, `simple square: 1 polygon (got ${multi?.length})`);
  assert(multi != null && multi[0].length === 1, `simple square: 1 ring per polygon (got ${multi?.[0].length})`);
}

// 2. objectToPolygon: donut (outer + hole) groups into ONE polygon with TWO rings
{
  const obj = makePathObject([
    squareSubPath(0, 0, 50),       // outer
    squareSubPath(15, 15, 20),     // hole at center
  ]);
  const multi = objectToPolygon(obj);
  assert(multi != null && multi.length === 1,
    `donut: groups into 1 polygon — pre-T1-36 was 2 polygons (got ${multi?.length})`);
  assert(multi != null && multi[0].length === 2,
    `donut: polygon has outer + hole (got ${multi?.[0].length} rings)`);
}

// 3. objectToPolygon: two disjoint squares produce TWO polygons
{
  const obj = makePathObject([
    squareSubPath(0, 0, 20),
    squareSubPath(100, 100, 20),
  ]);
  const multi = objectToPolygon(obj);
  assert(multi != null && multi.length === 2, `two disjoint squares: 2 polygons (got ${multi?.length})`);
  for (const p of multi ?? []) {
    assert(p.length === 1, `disjoint square: 1 ring (got ${p.length})`);
  }
}

// 4. objectToPolygon: outer + hole + island (letter-B-style nesting)
{
  const obj = makePathObject([
    squareSubPath(0, 0, 100),     // outer (depth 0)
    squareSubPath(20, 20, 60),    // hole (depth 1)
    squareSubPath(40, 40, 20),    // island inside hole (depth 2)
  ]);
  const multi = objectToPolygon(obj);
  // Expected: 2 polygons. Polygon A = [outer, hole]. Polygon B = [island].
  assert(multi != null && multi.length === 2,
    `island case: 2 polygons (outer+hole grouped; island as own outer; got ${multi?.length})`);
  // The polygon containing the outer ring should also contain the hole.
  const outerPoly = (multi ?? []).find(p => p[0][0][0] === 0 && p[0][0][1] === 0);
  assert(outerPoly != null && outerPoly.length === 2,
    `island case: outer polygon has outer+hole (got ${outerPoly?.length} rings)`);
  const islandPoly = (multi ?? []).find(p => p[0][0][0] === 40 && p[0][0][1] === 40);
  assert(islandPoly != null && islandPoly.length === 1,
    `island case: island stands as its own outer (got ${islandPoly?.length} rings)`);
}

// 5. offsetObject preserves the hole on a +1mm outset of a donut
{
  const obj = makePathObject([
    squareSubPath(0, 0, 50),
    squareSubPath(15, 15, 20),
  ]);
  const offset = offsetObject(obj, 1);
  assert(offset != null, 'donut +1mm: result not null');
  assert(offset != null && offset.subPaths.length >= 2,
    `donut +1mm: result has ≥2 subPaths (outer+hole preserved; got ${offset?.subPaths.length})`);
  const bounds = offset != null ? bbox(offset) : null;
  // Outer should grow from 50×50 to ~52×52 (margin 1mm on each side).
  assert(bounds != null && bounds.maxX - bounds.minX > 50 && bounds.maxX - bounds.minX < 54,
    `donut +1mm: outer bounds widened to ~52mm (got ${bounds ? (bounds.maxX - bounds.minX).toFixed(2) : 'null'})`);
}

// 6. offsetObject -1mm padding shrinks outer and grows hole inward
{
  const obj = makePathObject([
    squareSubPath(0, 0, 50),
    squareSubPath(15, 15, 20),
  ]);
  const offset = offsetObject(obj, -1);
  assert(offset != null, 'donut -1mm: result not null');
  if (offset != null) {
    assert(offset.subPaths.length >= 2,
      `donut -1mm: result has ≥2 subPaths (got ${offset.subPaths.length})`);
    const bounds = bbox(offset);
    // Outer shrinks from 50×50 to ~48×48.
    const outerW = bounds.maxX - bounds.minX;
    assert(outerW > 46 && outerW < 50,
      `donut -1mm: outer bounds narrowed to ~48mm (got ${outerW.toFixed(2)})`);
  }
}

// 7. Hole grows in the +1mm outset case (i.e., the hole interior gets
//    smaller — kerf comp shaves the hole edge inward into the material
//    so finished hole matches design size). Find the smaller subpath
//    in the result and verify its bounds match a ~18×18 inner.
{
  const obj = makePathObject([
    squareSubPath(0, 0, 50),
    squareSubPath(15, 15, 20),
  ]);
  const offset = offsetObject(obj, 1);
  if (offset != null && offset.subPaths.length >= 2) {
    const sortedBySize = offset.subPaths.map(subPathBounds).sort((a, b) =>
      (a.maxX - a.minX) - (b.maxX - b.minX));
    const inner = sortedBySize[0];
    const innerW = inner.maxX - inner.minX;
    // Hole started at 20×20; after +1mm offset on the compound polygon
    // the hole shrinks (toward material) to ~18×18.
    assert(innerW > 16 && innerW < 20,
      `donut +1mm: hole shrinks to ~18mm (got ${innerW.toFixed(2)})`);
  }
}

// 8. Simple shape (no holes) still works — regression check on
//    non-compound geometry.
{
  const obj = makePathObject([squareSubPath(0, 0, 50)]);
  const offset = offsetObject(obj, 1);
  assert(offset != null && offset.subPaths.length === 1,
    `simple square +1mm: 1 subPath (got ${offset?.subPaths.length})`);
  if (offset != null) {
    const b = bbox(offset);
    const w = b.maxX - b.minX;
    assert(w > 50 && w < 54, `simple square +1mm: bounds widened to ~52mm (got ${w.toFixed(2)})`);
  }
}

// 9. Winding is auto-corrected — give a CW outer + CCW hole and the
//    offset still works (the helper rewinds them before passing to
//    polygon-offset).
{
  const obj = makePathObject([
    squareSubPath(0, 0, 50, /* ccw */ false),  // CW outer
    squareSubPath(15, 15, 20, /* ccw */ true), // CCW hole
  ]);
  const multi = objectToPolygon(obj);
  // Even with input winding wrong, the containment grouping still
  // produces 1 polygon with 2 rings (winding doesn't affect
  // pointInRing's even-odd evaluation).
  assert(multi != null && multi.length === 1 && multi[0].length === 2,
    `wrong-winding donut: still groups as 1 polygon, 2 rings`);
  const offset = offsetObject(obj, 1);
  assert(offset != null && offset.subPaths.length >= 2,
    `wrong-winding donut +1mm: hole still preserved through offset (got ${offset?.subPaths.length})`);
}

// 10. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const offsetSrc = fs.readFileSync(path.resolve(here, '../src/geometry/OffsetPath.ts'), 'utf-8');
  assert(/T1-36/.test(offsetSrc), 'T1-36 marker in OffsetPath.ts');
  assert(/wantedHoles/.test(offsetSrc), 'OffsetPath collects wantedHoles to pass through');
  assert(/ensureWinding/.test(offsetSrc), 'OffsetPath enforces canonical winding');
  const boolSrc = fs.readFileSync(path.resolve(here, '../src/geometry/BooleanOps.ts'), 'utf-8');
  assert(/T1-36/.test(boolSrc), 'T1-36 marker in BooleanOps.ts');
  assert(/groupRingsByContainment/.test(boolSrc),
    'BooleanOps exports groupRingsByContainment helper');
  assert(/pointInRing/.test(boolSrc), 'BooleanOps has pointInRing helper');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
