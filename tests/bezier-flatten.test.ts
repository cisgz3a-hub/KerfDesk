/**
 * T1-148: regression test for the pure bezier-subdivision + transform
 * primitives extracted from JobCompiler. The flatness-tolerance rule
 * + depth cap are load-bearing: too coarse a tolerance produces
 * visible faceting in the burned workpiece (T1-38 sets cut/score
 * tolerance to 0.05mm); too aggressive a recursion can blow the
 * stack on pathological control points.
 *
 * Run: npx tsx tests/bezier-flatten.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Point, Matrix3x2 } from '../src/core/types';
import {
  applyTransform,
  midpoint,
  subdivideCubic,
  subdivideQuadratic,
} from '../src/core/job/bezierFlatten';

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

function approxEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

console.log('\n=== T1-148 bezier flatten + transform ===\n');

// -------- midpoint --------
{
  const m = midpoint({ x: 0, y: 0 }, { x: 10, y: 20 });
  assert(m.x === 5 && m.y === 10, 'midpoint((0,0),(10,20)) = (5,10)');
  const m2 = midpoint({ x: -4, y: 8 }, { x: 4, y: -8 });
  assert(m2.x === 0 && m2.y === 0, 'midpoint of opposites = origin');
}

// -------- applyTransform --------
{
  const identity: Matrix3x2 = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const p = applyTransform({ x: 3, y: 4 }, identity);
  assert(p.x === 3 && p.y === 4, 'identity transform → unchanged');

  // Translate (5, 6)
  const translate: Matrix3x2 = { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 6 };
  const p2 = applyTransform({ x: 0, y: 0 }, translate);
  assert(p2.x === 5 && p2.y === 6, 'translate (5,6) at origin → (5,6)');

  // Scale by 2
  const scale: Matrix3x2 = { a: 2, b: 0, c: 0, d: 2, tx: 0, ty: 0 };
  const p3 = applyTransform({ x: 3, y: 4 }, scale);
  assert(p3.x === 6 && p3.y === 8, 'scale 2x → doubled coords');

  // 90° rotation: a=0, b=1, c=-1, d=0
  const rot: Matrix3x2 = { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 };
  const p4 = applyTransform({ x: 1, y: 0 }, rot);
  assert(approxEqual(p4.x, 0) && approxEqual(p4.y, 1),
    '90° rotate (1,0) → (0,1)');
}

// -------- subdivideCubic: straight chord → just endpoint --------
{
  const output: Point[] = [];
  // Control points colinear with endpoints; flatness test passes immediately
  subdivideCubic(
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 6, y: 0 },
    { x: 10, y: 0 },
    output, 0.01,
  );
  assert(output.length === 1,
    'cubic with colinear controls (straight) → 1 endpoint emitted');
  assert(output[0].x === 10 && output[0].y === 0,
    'emitted endpoint is p3');
}

// -------- subdivideCubic: curved → multiple segments --------
{
  const output: Point[] = [];
  // Big arc — controls pull strongly away from the chord
  subdivideCubic(
    { x: 0, y: 0 },
    { x: 5, y: 30 },
    { x: 95, y: 30 },
    { x: 100, y: 0 },
    output, 0.1,
  );
  assert(output.length > 2,
    'curved cubic → multiple subdivision endpoints');
  const last = output[output.length - 1];
  assert(last.x === 100 && last.y === 0,
    'last emitted point is p3');
}

// -------- subdivideCubic: depth cap at 10 --------
{
  const output: Point[] = [];
  // Same curve, depth pre-seeded near cap — should just emit endpoint
  subdivideCubic(
    { x: 0, y: 0 },
    { x: 5, y: 30 },
    { x: 95, y: 30 },
    { x: 100, y: 0 },
    output, 0.0001, 11,
  );
  assert(output.length === 1, 'depth > 10 → cuts short with just endpoint');
}

// -------- subdivideQuadratic --------
{
  // Straight (control on chord) → 1 endpoint
  const out1: Point[] = [];
  subdivideQuadratic(
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    out1, 0.01,
  );
  assert(out1.length === 1, 'straight quadratic → 1 endpoint');
  assert(out1[0].x === 10 && out1[0].y === 0, 'last point is p2');

  // Curved
  const out2: Point[] = [];
  subdivideQuadratic(
    { x: 0, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 0 },
    out2, 0.1,
  );
  assert(out2.length > 2, 'curved quadratic → multiple segments');
  const last = out2[out2.length - 1];
  assert(last.x === 100 && last.y === 0, 'last is p2');

  // Depth cap
  const out3: Point[] = [];
  subdivideQuadratic(
    { x: 0, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 0 },
    out3, 0.0001, 11,
  );
  assert(out3.length === 1, 'depth > 10 cuts short');
}

// -------- divide-by-zero guard for zero-length chord --------
{
  const out: Point[] = [];
  // p0 === p3 (zero-length chord); the `|| 1` guard means flatness
  // test divides by 1, not 0
  subdivideCubic(
    { x: 5, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 5 },
    out, 0.01,
  );
  assert(out.length === 1, 'zero-length cubic → 1 endpoint (no NaN)');
}

// -------- Source-level pin: JobCompiler delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const jcSrc = readFileSync(
    resolve(here, '../src/core/job/JobCompiler.ts'),
    'utf-8',
  );
  assert(/from '\.\/bezierFlatten'/.test(jcSrc),
    'JobCompiler imports from ./bezierFlatten');
  assert(/T1-148/.test(jcSrc),
    'JobCompiler carries T1-148 marker');
  assert(!/^function subdivideCubic/m.test(jcSrc),
    'inline subdivideCubic is gone');
  assert(!/^function subdivideQuadratic/m.test(jcSrc),
    'inline subdivideQuadratic is gone');
  assert(!/^function applyTransform/m.test(jcSrc),
    'inline applyTransform is gone');
  assert(!/^function midpoint/m.test(jcSrc),
    'inline midpoint is gone');

  const helperSrc = readFileSync(
    resolve(here, '../src/core/job/bezierFlatten.ts'),
    'utf-8',
  );
  assert(/T1-148/.test(helperSrc),
    'bezierFlatten carries T1-148 marker');
  for (const name of ['subdivideCubic', 'subdivideQuadratic', 'applyTransform', 'midpoint']) {
    const re = new RegExp(`export function ${name}`);
    assert(re.test(helperSrc), `${name} is exported`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
