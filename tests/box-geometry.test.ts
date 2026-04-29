/**
 * Regression tests for finger-joint box geometry.
 * Run: npx tsx tests/box-geometry.test.ts
 */
import { generateBoxFaces, generateRectWithFingers } from '../src/core/box/boxGeometry';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function assertEq(a: unknown, b: unknown, msg: string): void {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) {
    console.error('expected', b);
    console.error('actual', a);
  }
  assert(ok, msg);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function uniqueRounded(values: number[]): number[] {
  return [...new Set(values.map(round))].sort((a, b) => a - b);
}

function face(faces: ReturnType<typeof generateBoxFaces>, name: string) {
  const found = faces.find(f => f.name === name);
  if (!found) throw new Error(`missing face ${name}`);
  return found;
}

function min(points: Array<{ x: number; y: number }>, key: 'x' | 'y'): number {
  return round(Math.min(...points.map(p => p[key])));
}

function max(points: Array<{ x: number; y: number }>, key: 'x' | 'y'): number {
  return round(Math.max(...points.map(p => p[key])));
}

function xsAtY(points: Array<{ x: number; y: number }>, y: number): number[] {
  return uniqueRounded(points.filter(p => Math.abs(p.y - y) < 0.001).map(p => p.x));
}

function ysAtX(points: Array<{ x: number; y: number }>, x: number): number[] {
  return uniqueRounded(points.filter(p => Math.abs(p.x - x) < 0.001).map(p => p.y));
}

const params = {
  width: 80,
  height: 50,
  depth: 40,
  thickness: 3,
  fingerWidth: 10,
  openTop: false,
};

const closed = generateBoxFaces(params);
const open = generateBoxFaces({ ...params, openTop: true });

console.log('\n=== box geometry ===\n');

assertEq(closed.length, 6, 'closed box has 6 faces');
assertEq(open.length, 5, 'open-top box has 5 faces');
assertEq(closed.map(f => f.name), ['Front', 'Back', 'Left', 'Right', 'Bottom', 'Top'], 'closed face order is stable');
assert(!open.some(f => f.name === 'Top'), 'open-top omits Top face');
assert(open.some(f => f.name === 'Bottom'), 'open-top keeps Bottom face');

const bottom = face(closed, 'Bottom');
assertEq(min(bottom.points, 'y'), -3, 'Bottom top edge has outward fingers');
assertEq(max(bottom.points, 'y'), 43, 'Bottom bottom edge has outward fingers');
assertEq(min(bottom.points, 'x'), -3, 'Bottom left edge has outward fingers');
assertEq(max(bottom.points, 'x'), 83, 'Bottom right edge has outward fingers');
assert(xsAtY(bottom.points, -3).length > 0, 'Bottom top finger x positions exist');
assertEq(xsAtY(bottom.points, -3), xsAtY(bottom.points, 43), 'Bottom top/bottom finger phases match');

const front = face(closed, 'Front');
assertEq(min(front.points, 'x'), -3, 'Front left edge has outward fingers');
assertEq(max(front.points, 'x'), 83, 'Front right edge has outward fingers');
assertEq(min(front.points, 'y'), 0, 'Front top has no outward fingers');
assertEq(max(front.points, 'y'), 50, 'Front bottom has no outward fingers');
assert(xsAtY(front.points, 3).length > 0, 'Front top edge has inward slots');
assert(xsAtY(front.points, 47).length > 0, 'Front bottom edge has inward slots');
assertEq(ysAtX(front.points, -3), ysAtX(front.points, 83), 'Front left/right finger phases match');

const left = face(closed, 'Left');
assertEq(min(left.points, 'x'), 0, 'Left face has no outward left fingers');
assertEq(max(left.points, 'x'), 40, 'Left face has no outward right fingers');
assertEq(min(left.points, 'y'), 0, 'Left face has no outward top fingers');
assertEq(max(left.points, 'y'), 50, 'Left face has no outward bottom fingers');
assert(ysAtX(left.points, 3).length > 0, 'Left face left edge has inward slots');
assert(ysAtX(left.points, 37).length > 0, 'Left face right edge has inward slots');
assert(xsAtY(left.points, 3).length > 0, 'Left face top edge has inward slots');
assert(xsAtY(left.points, 47).length > 0, 'Left face bottom edge has inward slots');

for (const name of ['Front', 'Back']) {
  const side = face(open, name);
  assertEq(xsAtY(side.points, params.thickness), [], `${name} open-top rim has no horizontal top slots`);
}
for (const name of ['Left', 'Right']) {
  const side = face(open, name);
  assertEq(xsAtY(side.points, params.thickness), [], `${name} open-top rim has no horizontal top slots`);
}
assertEq(min(face(open, 'Front').points, 'y'), 0, 'open-top Front rim is flat at y=0');

const top = face(closed, 'Top');
assertEq(xsAtY(front.points, 3), xsAtY(top.points, -3), 'Top fingers align with Front top slots');
assertEq(xsAtY(bottom.points, 43), xsAtY(front.points, 47), 'Bottom fingers align with Front bottom slots');
assertEq(ysAtX(front.points, -3), ysAtX(left.points, 37), 'Front left fingers align with Left right slots');
assertEq(ysAtX(face(closed, 'Back').points, 83), ysAtX(face(closed, 'Right').points, 3), 'Back right fingers align with Right left slots');

const flat = generateRectWithFingers(20, 10, 2, 5, 'flat', 'flat', 'flat', 'flat');
assertEq(flat.length, 17, 'flat helper preserves segmented closed polygon');
assertEq([min(flat, 'x'), max(flat, 'x'), min(flat, 'y'), max(flat, 'y')], [0, 20, 0, 10], 'flat helper stays inside bounds');
assert(flat.every(p => p.x >= 0 && p.x <= 20 && p.y >= 0 && p.y <= 10), 'flat helper has no out-of-bounds points');

assertEq(min(generateRectWithFingers(20, 10, 2, 5, 'finger', 'flat', 'flat', 'flat'), 'y'), -2, 'top finger protrudes outward');
assertEq(max(generateRectWithFingers(20, 10, 2, 5, 'slot', 'flat', 'flat', 'flat'), 'y'), 10, 'top slot does not protrude below bottom');
assert(xsAtY(generateRectWithFingers(20, 10, 2, 5, 'slot', 'flat', 'flat', 'flat'), 2).length > 0, 'top slot cuts inward');
assertEq(max(generateRectWithFingers(20, 10, 2, 5, 'flat', 'flat', 'flat', 'finger'), 'x'), 22, 'right finger protrudes outward');
assert(ysAtX(generateRectWithFingers(20, 10, 2, 5, 'flat', 'flat', 'flat', 'slot'), 18).length > 0, 'right slot cuts inward');
assertEq(max(generateRectWithFingers(20, 10, 2, 5, 'flat', 'finger', 'flat', 'flat'), 'y'), 12, 'bottom finger protrudes outward');
assert(xsAtY(generateRectWithFingers(20, 10, 2, 5, 'flat', 'slot', 'flat', 'flat'), 8).length > 0, 'bottom slot cuts inward');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
