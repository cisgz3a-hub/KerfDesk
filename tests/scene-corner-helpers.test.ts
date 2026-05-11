/**
 * T1-138: regression test for the pure `getSceneObjectLocalCorners`
 * helper extracted from SceneRenderer. Used by the fill-preview
 * renderer to compute a local-space AABB before scan-converting fill
 * lines.
 *
 * Run: npx tsx tests/scene-corner-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Geometry } from '../src/core/scene/SceneObject';
import { getSceneObjectLocalCorners } from '../src/ui/renderers/sceneCornerHelpers';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-138 scene corner helpers ===\n');

// -------- 1. rect → two opposite corners --------
{
  const r = getSceneObjectLocalCorners({
    type: 'rect', x: 5, y: 7, width: 10, height: 20, cornerRadius: 0,
  } as Geometry);
  assert(r.length === 2, 'rect → 2 corners');
  assert(r[0].x === 5 && r[0].y === 7,
    'rect first corner = (x, y)');
  assert(r[1].x === 15 && r[1].y === 27,
    'rect second corner = (x+w, y+h)');
}

// -------- 2. ellipse → AABB corners from cx/cy ± rx/ry --------
{
  const r = getSceneObjectLocalCorners({
    type: 'ellipse', cx: 10, cy: 20, rx: 3, ry: 4,
  } as Geometry);
  assert(r.length === 2, 'ellipse → 2 corners');
  assert(r[0].x === 7 && r[0].y === 16,
    'ellipse min corner = (cx-rx, cy-ry)');
  assert(r[1].x === 13 && r[1].y === 24,
    'ellipse max corner = (cx+rx, cy+ry)');
}

// -------- 3. polygon → its own points --------
{
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];
  const r = getSceneObjectLocalCorners({
    type: 'polygon', points, closed: true,
  } as Geometry);
  assert(r.length === 3, 'polygon → as many points as it has');
  assert(r === points || (r[0].x === 0 && r[2].x === 5),
    'polygon returns its vertex list');
}

// -------- 4. line / text / image → [] --------
{
  assert(getSceneObjectLocalCorners({ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 } as Geometry).length === 0,
    'line → []');
  assert(getSceneObjectLocalCorners({ type: 'image' } as unknown as Geometry).length === 0,
    'image → []');
  assert(getSceneObjectLocalCorners({ type: 'text' } as unknown as Geometry).length === 0,
    'text → []');
}

// -------- 5. path: move + line → endpoints --------
{
  const r = getSceneObjectLocalCorners({
    type: 'path',
    subPaths: [
      {
        segments: [
          { type: 'move', to: { x: 0, y: 0 } },
          { type: 'line', to: { x: 10, y: 0 } },
          { type: 'line', to: { x: 10, y: 10 } },
          { type: 'close' },
        ],
        closed: true,
      },
    ],
  } as Geometry);
  // 3 endpoints (move + line + line); close has no point.
  assert(r.length === 3, 'path with move + 2 lines → 3 points');
  assert(r[0].x === 0 && r[2].y === 10, 'first and last points match');
}

// -------- 6. path: cubic → control points + endpoint (3 per cubic) --------
{
  const r = getSceneObjectLocalCorners({
    type: 'path',
    subPaths: [
      {
        segments: [
          { type: 'move', to: { x: 0, y: 0 } },
          {
            type: 'cubic',
            cp1: { x: 5, y: 5 },
            cp2: { x: 10, y: 5 },
            to: { x: 15, y: 0 },
          },
        ],
        closed: false,
      },
    ],
  } as Geometry);
  // move (1) + cubic (3 = cp1 + cp2 + to) = 4 points
  assert(r.length === 4, 'cubic adds cp1 + cp2 + to (3 points)');
}

// -------- 7. path: quadratic → control point + endpoint --------
{
  const r = getSceneObjectLocalCorners({
    type: 'path',
    subPaths: [
      {
        segments: [
          { type: 'move', to: { x: 0, y: 0 } },
          { type: 'quadratic', cp: { x: 5, y: 10 }, to: { x: 10, y: 0 } },
        ],
        closed: false,
      },
    ],
  } as Geometry);
  // move + quadratic (2 = cp + to) = 3 points
  assert(r.length === 3, 'quadratic adds cp + to (2 points)');
}

// -------- 8. path: empty subPaths → [] --------
{
  const r = getSceneObjectLocalCorners({
    type: 'path', subPaths: [],
  } as Geometry);
  assert(r.length === 0, 'path with no subPaths → []');
}

// -------- 9. unknown geometry type → [] --------
{
  const r = getSceneObjectLocalCorners({ type: 'something' } as unknown as Geometry);
  assert(r.length === 0, 'unknown type → []');
}

// -------- 10. Source-level pin: SceneRenderer delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const rendererSrc = readFileSync(
    resolve(here, '../src/ui/renderers/SceneRenderer.ts'),
    'utf-8',
  );
  assert(/from '\.\/sceneCornerHelpers'/.test(rendererSrc),
    'SceneRenderer imports from ./sceneCornerHelpers');
  assert(/getSceneObjectLocalCorners\(geom\)/.test(rendererSrc),
    'SceneRenderer calls getSceneObjectLocalCorners(geom)');
  assert(/T1-138/.test(rendererSrc),
    'SceneRenderer carries T1-138 marker');
  // Inline getLocalCorners function is gone.
  assert(!/^function getLocalCorners/m.test(rendererSrc),
    'inline getLocalCorners function is gone from SceneRenderer');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/renderers/sceneCornerHelpers.ts'),
    'utf-8',
  );
  assert(/T1-138/.test(helperSrc),
    'sceneCornerHelpers carries T1-138 marker');
  assert(/export function getSceneObjectLocalCorners/.test(helperSrc),
    'getSceneObjectLocalCorners is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
