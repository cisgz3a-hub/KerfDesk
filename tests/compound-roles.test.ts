/**
 * T1-147: regression test for the pure compound-role inference +
 * point-in-polygon helpers extracted from JobCompiler.
 *
 * The role classifier (`outer` / `hole` / `island` / `open`) is the
 * basis for the planner's containment ordering — getting it wrong
 * means the planner could cut a hole-shape AFTER its enclosing outer,
 * leaving the workpiece dropping out before the outer cut completes.
 *
 * Run: npx tsx tests/compound-roles.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Point } from '../src/core/types';
import {
  inferCompoundRoles,
  pointInPointGroup,
  type InferRolesGroup,
} from '../src/core/job/compoundRoles';

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

function box(x: number, y: number, w: number, h: number): InferRolesGroup {
  return {
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    closed: true,
  };
}

console.log('\n=== T1-147 compound-role inference ===\n');

// -------- pointInPointGroup --------
{
  const poly: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert(pointInPointGroup({ x: 5, y: 5 }, poly), 'center is inside');
  assert(!pointInPointGroup({ x: -1, y: 5 }, poly), 'left of poly is outside');
  assert(!pointInPointGroup({ x: 11, y: 5 }, poly), 'right of poly is outside');
  assert(!pointInPointGroup({ x: 5, y: -1 }, poly), 'above poly is outside');
  assert(!pointInPointGroup({ x: 5, y: 11 }, poly), 'below poly is outside');
  // Note: edge behavior is implementation-defined; classic ray-cast
  // typically returns false for boundary points but we don't pin that.
}

// -------- pointInPointGroup: divide-by-zero guard --------
{
  // Polygon with a horizontal edge whose yj == yi == 5 — the
  // `|| 1e-12` guard keeps the formula from producing NaN.
  const poly: Point[] = [
    { x: 0, y: 5 },
    { x: 10, y: 5 },
    { x: 5, y: 10 },
  ];
  // Just check it doesn't throw / return NaN — the result is impl-defined.
  const r = pointInPointGroup({ x: 5, y: 7 }, poly);
  assert(typeof r === 'boolean', 'horizontal edge → returns a bool (no NaN)');
}

// -------- inferCompoundRoles --------
{
  // Single closed outer → outer
  const r = inferCompoundRoles([box(0, 0, 100, 100)]);
  assert(r.length === 1 && r[0] === 'outer', 'single closed group → outer');
}
{
  // Open contour → open
  const open: InferRolesGroup = {
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    closed: false,
  };
  const r = inferCompoundRoles([open]);
  assert(r[0] === 'open', 'open contour → open');
}
{
  // Outer + inner hole
  const outer = box(0, 0, 100, 100);
  const hole = box(20, 20, 20, 20);
  const r = inferCompoundRoles([outer, hole]);
  assert(r[0] === 'outer', 'outer (depth 0) → outer');
  assert(r[1] === 'hole', 'inner (depth 1) → hole');
}
{
  // Outer + hole + island (3 nested levels)
  const r = inferCompoundRoles([
    box(0, 0, 100, 100),    // outer (depth 0)
    box(20, 20, 60, 60),    // hole (depth 1)
    box(40, 40, 20, 20),    // island (depth 2)
  ]);
  assert(r[0] === 'outer', 'level 0 → outer');
  assert(r[1] === 'hole', 'level 1 → hole');
  assert(r[2] === 'island', 'level 2 → island');
}
{
  // 5 nested levels: outer / hole / island / hole / island
  const r = inferCompoundRoles([
    box(0, 0, 100, 100),    // depth 0
    box(10, 10, 80, 80),    // depth 1
    box(20, 20, 60, 60),    // depth 2
    box(30, 30, 40, 40),    // depth 3
    box(40, 40, 20, 20),    // depth 4
  ]);
  assert(r[0] === 'outer', 'depth 0 → outer');
  assert(r[1] === 'hole', 'depth 1 → hole');
  assert(r[2] === 'island', 'depth 2 → island');
  assert(r[3] === 'hole', 'depth 3 → hole');
  assert(r[4] === 'island', 'depth 4 → island');
}
{
  // Open + closed: open stays open even if inside a closed
  const open: InferRolesGroup = {
    points: [{ x: 50, y: 50 }, { x: 51, y: 50 }],
    closed: false,
  };
  const r = inferCompoundRoles([box(0, 0, 100, 100), open]);
  assert(r[0] === 'outer', 'outer → outer');
  assert(r[1] === 'open', 'open inside outer → still open');
}
{
  // Closed group with <3 points doesn't count as a containing polygon
  const tinyClosed: InferRolesGroup = {
    points: [{ x: 5, y: 5 }, { x: 6, y: 5 }],
    closed: true,
  };
  // Outer can't be "inside" tinyClosed because tinyClosed has <3 points.
  const r = inferCompoundRoles([box(0, 0, 100, 100), tinyClosed]);
  assert(r[0] === 'outer', 'outer with degenerate sibling → still outer');
  // tinyClosed is also outer (depth 0 — nothing contains it either; the
  // outer box doesn't contain it because both are closed but the box
  // is the outer one)
  // Actually box(0,0,100,100) DOES contain (5,5), so tinyClosed depth=1.
  assert(r[1] === 'hole',
    'degenerate closed → still classified (depth from box → hole)');
}

// -------- Source-level pin: JobCompiler delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const jcSrc = readFileSync(
    resolve(here, '../src/core/job/JobCompiler.ts'),
    'utf-8',
  );
  assert(/from '\.\/compoundRoles'/.test(jcSrc),
    'JobCompiler imports from ./compoundRoles');
  assert(/T1-147/.test(jcSrc),
    'JobCompiler carries T1-147 marker');
  assert(!/^function inferCompoundRoles/m.test(jcSrc),
    'inline inferCompoundRoles is gone from JobCompiler');
  assert(!/^function pointInPointGroup/m.test(jcSrc),
    'inline pointInPointGroup is gone');

  const helperSrc = readFileSync(
    resolve(here, '../src/core/job/compoundRoles.ts'),
    'utf-8',
  );
  assert(/T1-147/.test(helperSrc),
    'compoundRoles carries T1-147 marker');
  assert(/export function inferCompoundRoles/.test(helperSrc),
    'inferCompoundRoles is exported');
  assert(/export function pointInPointGroup/.test(helperSrc),
    'pointInPointGroup is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
