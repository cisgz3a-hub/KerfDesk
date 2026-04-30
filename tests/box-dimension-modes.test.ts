/**
 * interiorToExterior / exteriorToInterior and equivalence with generateBoxFaces.
 * Run: npx tsx tests/box-dimension-modes.test.ts
 */
import {
  generateBoxFaces,
  interiorToExterior,
  exteriorToInterior,
} from '../src/core/box/boxGeometry';

let passed = 0;
let failed = 0;

function assert(c: boolean, msg: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function bottomExtents(faces: ReturnType<typeof generateBoxFaces>): { minX: number; maxX: number; minY: number; maxY: number } {
  const bottom = faces.find(f => f.name === 'Bottom');
  if (!bottom) throw new Error('no Bottom');
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of bottom.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

console.log('\n=== dimension modes — closed box exterior from interior ===\n');
{
  const t = 3;
  const e = interiorToExterior(74, 44, 34, t, false);
  assert(e.width === 80, 'closed: width + 2t');
  assert(e.height === 50, 'closed: height + 2t');
  assert(e.depth === 40, 'closed: depth + 2t');
}

console.log('\n=== dimension modes — open top adds one t to height ===\n');
{
  const t = 3;
  const eOpen = interiorToExterior(74, 44, 34, t, true);
  assert(eOpen.width === 80 && eOpen.depth === 40, 'open: W and D still +2t');
  assert(eOpen.height === 47, 'open: height + t only');
}

console.log('\n=== dimension modes — round-trip interior ↔ exterior ===\n');
{
  const cases: Array<{ w: number; h: number; d: number; t: number; open: boolean }> = [
    { w: 10, h: 12, d: 8, t: 2, open: false },
    { w: 100, h: 60, d: 40, t: 3, open: true },
    { w: 50, h: 30, d: 25, t: 4, open: false },
  ];
  for (const c of cases) {
    const ext = interiorToExterior(c.w, c.h, c.d, c.t, c.open);
    const back = exteriorToInterior(ext.width, ext.height, ext.depth, c.t, c.open);
    assert(
      Math.abs(back.width - c.w) < 1e-9 && Math.abs(back.height - c.h) < 1e-9 && Math.abs(back.depth - c.d) < 1e-9,
      `round-trip (${c.w},${c.h},${c.d}) t=${c.t} open=${c.open}`,
    );
  }
}

console.log('\n=== dimension modes — exterior 80×50×40 t=3 → cavity ===\n');
{
  const c = exteriorToInterior(80, 50, 40, 3, false);
  assert(c.width === 74, 'cavity width = exterior - 2t');
  assert(c.height === 44, 'cavity height closed = exterior - 2t');
  assert(c.depth === 34, 'cavity depth = exterior - 2t');
}

console.log('\n=== dimension modes — open-top exterior cavity uses one t on height ===\n');
{
  const c = exteriorToInterior(80, 50, 40, 3, true);
  assert(c.width === 74 && c.depth === 34, 'open: W/D cavity still -2t');
  assert(c.height === 47, 'open: cavity H = exterior H - t');
}

console.log('\n=== dimension modes — open vs closed cavity height differs by t ===\n');
{
  const t = 3;
  const insideH = 40;
  const closedExt = interiorToExterior(70, insideH, 30, t, false);
  const openExt = interiorToExterior(70, insideH, 30, t, true);
  assert(closedExt.height === 46, 'closed exterior H = insideH + 2t');
  assert(openExt.height === 43, 'open exterior H = insideH + t');
  assert(Math.abs(closedExt.height - openExt.height - t) < 1e-9, 'closed exterior H exceeds open by exactly t');
}

console.log('\n=== dimension modes — inside-mode resolves to same geometry as outside ===\n');
{
  const t = 3;
  const fw = 10;
  const outside = generateBoxFaces({
    width: 80, height: 50, depth: 40, thickness: t, fingerWidth: fw, openTop: false, kerf: 0,
  });
  const ext = interiorToExterior(74, 44, 34, t, false);
  const fromInside = generateBoxFaces({
    width: ext.width, height: ext.height, depth: ext.depth, thickness: t, fingerWidth: fw, openTop: false, kerf: 0,
  });
  assert(outside.length === 6 && fromInside.length === 6, 'same closed face count');
  const a = bottomExtents(outside);
  const b = bottomExtents(fromInside);
  assert(
    Math.abs(a.minX - b.minX) < 1e-6 && Math.abs(a.maxX - b.maxX) < 1e-6
    && Math.abs(a.minY - b.minY) < 1e-6 && Math.abs(a.maxY - b.maxY) < 1e-6,
    'Bottom polygon extents match outside vs inside-resolved',
  );
}

console.log('\n=== dimension modes — exterior round-trip ===\n');
{
  const t = 3;
  const extW = 80;
  const extH = 50;
  const extD = 40;
  const inside = exteriorToInterior(extW, extH, extD, t, false);
  const back = interiorToExterior(inside.width, inside.height, inside.depth, t, false);
  assert(back.width === extW && back.height === extH && back.depth === extD, 'exterior → interior → exterior');
}

console.log('\n=== dimension modes — zero-thickness edge (degenerate) ===\n');
{
  const e = interiorToExterior(10, 12, 8, 0, false);
  assert(e.width === 10 && e.height === 12 && e.depth === 8, 't=0: exterior equals interior');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
