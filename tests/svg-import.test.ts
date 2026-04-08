/**
 * === FILE: /tests/svg-import.test.ts ===
 *
 * Purpose:    Tests for SVG import: XML parsing, path data parsing,
 *             transform parsing, element conversion, and full
 *             Scene assembly from SVG strings.
 *
 * Run with: npx tsx tests/svg-import.test.ts
 */

import { importSVG, parsePathData, parseTransform, multiplyMatrix } from '../src/import/svg';
import { type Matrix3x2, IDENTITY_MATRIX } from '../src/core/types';

// ─── ASSERTIONS ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertClose(actual: number, expected: number, tol: number, msg: string): void {
  assert(Math.abs(actual - expected) < tol, `${msg} (got ${actual.toFixed(3)}, expected ${expected})`);
}

// ─── TEST: TRANSFORM PARSING ─────────────────────────────────────

console.log('\n=== Test: Transform Parsing ===');

// Identity
const t0 = parseTransform('');
assert(t0.a === 1 && t0.d === 1 && t0.tx === 0, 'Empty → identity');

const t0n = parseTransform(null);
assert(t0n.a === 1 && t0n.tx === 0, 'Null → identity');

// Translate
const t1 = parseTransform('translate(10, 20)');
assertClose(t1.tx, 10, 0.001, 'translate: tx = 10');
assertClose(t1.ty, 20, 0.001, 'translate: ty = 20');
assertClose(t1.a, 1, 0.001, 'translate: a = 1 (no scale)');

// Translate single arg
const t1b = parseTransform('translate(50)');
assertClose(t1b.tx, 50, 0.001, 'translate(50): tx = 50');
assertClose(t1b.ty, 0, 0.001, 'translate(50): ty = 0');

// Scale
const t2 = parseTransform('scale(2, 3)');
assertClose(t2.a, 2, 0.001, 'scale: a = 2');
assertClose(t2.d, 3, 0.001, 'scale: d = 3');
assertClose(t2.tx, 0, 0.001, 'scale: tx = 0');

// Scale uniform
const t2b = parseTransform('scale(2)');
assertClose(t2b.a, 2, 0.001, 'scale(2): a = 2');
assertClose(t2b.d, 2, 0.001, 'scale(2): d = 2');

// Rotate 90°
const t3 = parseTransform('rotate(90)');
assertClose(t3.a, 0, 0.001, 'rotate(90): a ≈ 0');
assertClose(t3.b, 1, 0.001, 'rotate(90): b ≈ 1');
assertClose(t3.c, -1, 0.001, 'rotate(90): c ≈ -1');
assertClose(t3.d, 0, 0.001, 'rotate(90): d ≈ 0');

// Matrix
const t4 = parseTransform('matrix(1,0,0,1,100,200)');
assertClose(t4.tx, 100, 0.001, 'matrix: tx = 100');
assertClose(t4.ty, 200, 0.001, 'matrix: ty = 200');

// Compound: translate then scale
const t5 = parseTransform('translate(10, 20) scale(2)');
// translate(10,20) × scale(2) = { a:2, d:2, tx:10, ty:20 }
assertClose(t5.a, 2, 0.001, 'compound: a = 2');
assertClose(t5.tx, 10, 0.001, 'compound: tx = 10');
assertClose(t5.ty, 20, 0.001, 'compound: ty = 20');

// Matrix multiply
const mA: Matrix3x2 = { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 20 };
const mB: Matrix3x2 = { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 3 };
const mAB = multiplyMatrix(mA, mB);
assertClose(mAB.tx, 20, 0.001, 'multiply: tx = 2*5 + 10 = 20');
assertClose(mAB.ty, 26, 0.001, 'multiply: ty = 2*3 + 20 = 26');

// ─── TEST: PATH PARSING ─────────────────────────────────────────

console.log('\n=== Test: Path Data Parsing ===');

// Simple line path
const p1 = parsePathData('M 10 10 L 90 10 L 90 90 Z');
assert(p1.subPaths.length === 1, 'Simple path: 1 subpath');
assert(p1.subPaths[0].closed === true, 'Simple path: closed');
assert(p1.subPaths[0].segments.length === 4, 'Simple path: 4 segments (M, L, L, Z)');

// Relative commands
const p2 = parsePathData('m 10 10 l 80 0 l 0 80 z');
assert(p2.subPaths.length === 1, 'Relative: 1 subpath');
assert(p2.subPaths[0].closed === true, 'Relative: closed');
// After m10,10 l80,0 → point should be at (90, 10)
const seg2 = p2.subPaths[0].segments[1]; // First lineto
assert(seg2.type === 'line', 'Relative: second segment is line');
if (seg2.type === 'line') {
  assertClose(seg2.to.x, 90, 0.001, 'Relative: L x = 10+80 = 90');
  assertClose(seg2.to.y, 10, 0.001, 'Relative: L y = 10');
}

// H and V commands
const p3 = parsePathData('M 0 0 H 100 V 50 H 0 Z');
assert(p3.subPaths[0].segments.length === 5, 'H/V: 5 segments');
const hSeg = p3.subPaths[0].segments[1];
assert(hSeg.type === 'line', 'H produces line');
if (hSeg.type === 'line') {
  assertClose(hSeg.to.x, 100, 0.001, 'H 100: x = 100');
  assertClose(hSeg.to.y, 0, 0.001, 'H 100: y unchanged');
}

// Cubic bezier
const p4 = parsePathData('M 0 0 C 10 20 30 40 50 60');
assert(p4.subPaths[0].segments.length === 2, 'Cubic: 2 segments (M + C)');
const cubicSeg = p4.subPaths[0].segments[1];
assert(cubicSeg.type === 'cubic', 'C produces cubic');
if (cubicSeg.type === 'cubic') {
  assertClose(cubicSeg.cp1.x, 10, 0.001, 'Cubic cp1.x = 10');
  assertClose(cubicSeg.cp2.x, 30, 0.001, 'Cubic cp2.x = 30');
  assertClose(cubicSeg.to.x, 50, 0.001, 'Cubic to.x = 50');
}

// Quadratic bezier
const p5 = parsePathData('M 0 0 Q 50 100 100 0');
const quadSeg = p5.subPaths[0].segments[1];
assert(quadSeg.type === 'quadratic', 'Q produces quadratic');
if (quadSeg.type === 'quadratic') {
  assertClose(quadSeg.cp.x, 50, 0.001, 'Quad cp.x = 50');
  assertClose(quadSeg.to.x, 100, 0.001, 'Quad to.x = 100');
}

// Multiple subpaths
const p6 = parsePathData('M 0 0 L 10 10 Z M 20 20 L 30 30');
assert(p6.subPaths.length === 2, 'Multi subpath: 2 subpaths');
assert(p6.subPaths[0].closed === true, 'Multi: first is closed');
assert(p6.subPaths[1].closed === false, 'Multi: second is open');

// Compact notation (no spaces)
const p7 = parsePathData('M10,20L30,40L50,60Z');
assert(p7.subPaths.length === 1, 'Compact: parses without spaces');
assert(p7.subPaths[0].segments.length === 4, 'Compact: 4 segments');

// Empty path
const p8 = parsePathData('');
assert(p8.subPaths.length === 0, 'Empty path: 0 subpaths');

// Implicit lineto after M
const p9 = parsePathData('M 0 0 10 10 20 20');
// After M 0 0, the "10 10" and "20 20" are implicit L
assert(p9.subPaths[0].segments.length === 3, 'Implicit L: 3 segments (M + 2 implicit L)');

// ─── TEST: RECT IMPORT ──────────────────────────────────────────

console.log('\n=== Test: Rect Import ===');

const svgRect = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect x="10" y="20" width="100" height="50" rx="5"/>
</svg>`;

const sceneRect = importSVG(svgRect);
assert(sceneRect.objects.length === 1, 'Rect: 1 object imported');
assert(sceneRect.canvas.width === 200, 'Rect: canvas width from viewBox');
assert(sceneRect.canvas.height === 200, 'Rect: canvas height from viewBox');

const rectObj = sceneRect.objects[0];
assert(rectObj.geometry.type === 'rect', 'Rect: geometry type is rect');
if (rectObj.geometry.type === 'rect') {
  assertClose(rectObj.geometry.x, 10, 0.001, 'Rect: x = 10');
  assertClose(rectObj.geometry.y, 20, 0.001, 'Rect: y = 20');
  assertClose(rectObj.geometry.width, 100, 0.001, 'Rect: width = 100');
  assertClose(rectObj.geometry.height, 50, 0.001, 'Rect: height = 50');
  assertClose(rectObj.geometry.cornerRadius, 5, 0.001, 'Rect: cornerRadius = 5');
}

// ─── TEST: CIRCLE / ELLIPSE IMPORT ───────────────────────────────

console.log('\n=== Test: Circle / Ellipse Import ===');

const svgCircle = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <circle cx="100" cy="80" r="40"/>
  <ellipse cx="50" cy="150" rx="30" ry="20"/>
</svg>`;

const sceneCircle = importSVG(svgCircle);
assert(sceneCircle.objects.length === 2, 'Circle/Ellipse: 2 objects');

const circleObj = sceneCircle.objects[0];
assert(circleObj.geometry.type === 'ellipse', 'Circle → ellipse geometry');
if (circleObj.geometry.type === 'ellipse') {
  assertClose(circleObj.geometry.cx, 100, 0.001, 'Circle: cx = 100');
  assertClose(circleObj.geometry.cy, 80, 0.001, 'Circle: cy = 80');
  assertClose(circleObj.geometry.rx, 40, 0.001, 'Circle: rx = r = 40');
  assertClose(circleObj.geometry.ry, 40, 0.001, 'Circle: ry = r = 40');
}

const ellipseObj = sceneCircle.objects[1];
if (ellipseObj.geometry.type === 'ellipse') {
  assertClose(ellipseObj.geometry.rx, 30, 0.001, 'Ellipse: rx = 30');
  assertClose(ellipseObj.geometry.ry, 20, 0.001, 'Ellipse: ry = 20');
}

// ─── TEST: LINE IMPORT ───────────────────────────────────────────

console.log('\n=== Test: Line Import ===');

const svgLine = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <line x1="10" y1="20" x2="190" y2="180"/>
</svg>`;

const sceneLine = importSVG(svgLine);
assert(sceneLine.objects.length === 1, 'Line: 1 object');
const lineObj = sceneLine.objects[0];
assert(lineObj.geometry.type === 'line', 'Line: geometry type is line');
if (lineObj.geometry.type === 'line') {
  assertClose(lineObj.geometry.x1, 10, 0.001, 'Line: x1 = 10');
  assertClose(lineObj.geometry.x2, 190, 0.001, 'Line: x2 = 190');
}

// ─── TEST: POLYGON / POLYLINE IMPORT ─────────────────────────────

console.log('\n=== Test: Polygon / Polyline Import ===');

const svgPoly = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <polygon points="100,10 40,198 190,78 10,78 160,198"/>
  <polyline points="0,0 50,50 100,0"/>
</svg>`;

const scenePoly = importSVG(svgPoly);
assert(scenePoly.objects.length === 2, 'Poly: 2 objects');

const polygonObj = scenePoly.objects[0];
assert(polygonObj.geometry.type === 'polygon', 'Polygon: correct type');
if (polygonObj.geometry.type === 'polygon') {
  assert(polygonObj.geometry.closed === true, 'Polygon: closed');
  assert(polygonObj.geometry.points.length === 5, 'Polygon: 5 points (star)');
}

const polylineObj = scenePoly.objects[1];
if (polylineObj.geometry.type === 'polygon') {
  assert(polylineObj.geometry.closed === false, 'Polyline: open');
  assert(polylineObj.geometry.points.length === 3, 'Polyline: 3 points');
}

// ─── TEST: PATH IMPORT ───────────────────────────────────────────

console.log('\n=== Test: Path Import ===');

const svgPath = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <path d="M 10 80 C 40 10 65 10 95 80 S 150 150 180 80" id="bezier-curve"/>
</svg>`;

const scenePath = importSVG(svgPath);
assert(scenePath.objects.length === 1, 'Path: 1 object');

const pathObj = scenePath.objects[0];
assert(pathObj.geometry.type === 'path', 'Path: geometry type is path');
assert(pathObj.name === 'bezier-curve', 'Path: name from id attribute');
if (pathObj.geometry.type === 'path') {
  assert(pathObj.geometry.subPaths.length === 1, 'Path: 1 subpath');
  // M + C + S = 3 segments
  assert(pathObj.geometry.subPaths[0].segments.length === 3, 'Path: 3 segments (M + C + S)');
}

// ─── TEST: NESTED GROUP TRANSFORMS ───────────────────────────────

console.log('\n=== Test: Nested Group Transforms ===');

const svgGroup = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <g transform="translate(100, 50)">
    <rect x="0" y="0" width="50" height="30"/>
    <g transform="translate(10, 10)">
      <circle cx="0" cy="0" r="5"/>
    </g>
  </g>
</svg>`;

const sceneGroup = importSVG(svgGroup);
assert(sceneGroup.objects.length === 2, 'Group: 2 objects (flattened)');

// Rect: should have translate(100, 50) baked into transform
const groupRect = sceneGroup.objects[0];
assertClose(groupRect.transform.tx, 100, 0.001, 'Group rect: tx = 100 (from parent group)');
assertClose(groupRect.transform.ty, 50, 0.001, 'Group rect: ty = 50 (from parent group)');

// Circle: should have translate(100,50) × translate(10,10) = translate(110, 60)
const groupCircle = sceneGroup.objects[1];
assertClose(groupCircle.transform.tx, 110, 0.001, 'Nested group circle: tx = 110 (100+10)');
assertClose(groupCircle.transform.ty, 60, 0.001, 'Nested group circle: ty = 60 (50+10)');

// ─── TEST: TRANSFORM + GEOMETRY INDEPENDENCE ─────────────────────

console.log('\n=== Test: Transform + Geometry Independence ===');

// Group transform should be in transform matrix, NOT baked into geometry
const svgTransformed = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <g transform="translate(50, 50) scale(2)">
    <rect x="10" y="10" width="30" height="20"/>
  </g>
</svg>`;

const sceneTrans = importSVG(svgTransformed);
const transRect = sceneTrans.objects[0];

// Geometry should be untouched (local coordinates)
if (transRect.geometry.type === 'rect') {
  assertClose(transRect.geometry.x, 10, 0.001, 'Transform: geometry x unchanged (local)');
  assertClose(transRect.geometry.width, 30, 0.001, 'Transform: geometry width unchanged');
}

// Transform should carry the group's translate+scale
assertClose(transRect.transform.a, 2, 0.001, 'Transform: scale X = 2');
assertClose(transRect.transform.d, 2, 0.001, 'Transform: scale Y = 2');
assertClose(transRect.transform.tx, 50, 0.001, 'Transform: translate X = 50');
assertClose(transRect.transform.ty, 50, 0.001, 'Transform: translate Y = 50');

// ─── TEST: MIXED ELEMENTS ────────────────────────────────────────

console.log('\n=== Test: Mixed Elements ===');

const svgMixed = `
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">
  <rect x="10" y="10" width="280" height="180"/>
  <circle cx="150" cy="100" r="50"/>
  <line x1="10" y1="100" x2="290" y2="100"/>
  <path d="M 50 150 Q 150 50 250 150"/>
  <polygon points="150,20 130,60 170,60"/>
</svg>`;

const sceneMixed = importSVG(svgMixed);
assert(sceneMixed.objects.length === 5, 'Mixed: 5 objects');
assert(sceneMixed.canvas.width === 300, 'Mixed: canvas width = 300');
assert(sceneMixed.canvas.height === 200, 'Mixed: canvas height = 200');

// Verify all types survived
const types = sceneMixed.objects.map(o => o.geometry.type);
assert(types.includes('rect'), 'Mixed: has rect');
assert(types.includes('ellipse'), 'Mixed: has ellipse (from circle)');
assert(types.includes('line'), 'Mixed: has line');
assert(types.includes('path'), 'Mixed: has path');
assert(types.includes('polygon'), 'Mixed: has polygon');

// All objects should be on the default layer
const defaultLayerId = sceneMixed.layers[0].id;
assert(sceneMixed.objects.every(o => o.layerId === defaultLayerId), 'Mixed: all on default layer');

// ─── TEST: SVG WITHOUT VIEWBOX ───────────────────────────────────

console.log('\n=== Test: SVG Without ViewBox ===');

const svgNoViewBox = `
<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300">
  <rect x="0" y="0" width="100" height="100"/>
</svg>`;

const sceneNoVB = importSVG(svgNoViewBox);
assert(sceneNoVB.canvas.width === 500, 'No viewBox: width from width attr');
assert(sceneNoVB.canvas.height === 300, 'No viewBox: height from height attr');

// ─── TEST: EMPTY / INVALID SVG ───────────────────────────────────

console.log('\n=== Test: Empty / Invalid SVG ===');

const sceneEmpty = importSVG('');
assert(sceneEmpty.objects.length === 0, 'Empty SVG: 0 objects');

const sceneInvalid = importSVG('<div>not svg</div>');
assert(sceneInvalid.objects.length === 0, 'Invalid SVG: 0 objects');

const sceneNoElements = importSVG('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
assert(sceneNoElements.objects.length === 0, 'Empty SVG element: 0 objects');

// ─── TEST: UNIT CONVERSION ───────────────────────────────────────

console.log('\n=== Test: Unit Conversion ===');

import { parseLength, parseLengthMm } from '../src/import/svg';

// mm
const uMm = parseLength('200mm');
assert(uMm !== null, 'parseLength: 200mm parses');
if (uMm) {
  assertClose(uMm.mm, 200, 0.001, '200mm = 200mm');
  assert(uMm.unit === 'mm', 'unit = mm');
}

// cm
const uCm = parseLength('10cm');
if (uCm) assertClose(uCm.mm, 100, 0.001, '10cm = 100mm');

// inch
const uIn = parseLength('2in');
if (uIn) assertClose(uIn.mm, 50.8, 0.001, '2in = 50.8mm');

// px (explicit)
const uPx = parseLength('96px');
if (uPx) assertClose(uPx.mm, 25.4, 0.01, '96px = 25.4mm (1 inch at 96 DPI)');

// no unit = mm (laser convention)
const uNone = parseLength('300');
if (uNone) {
  assertClose(uNone.mm, 300, 0.001, '300 (no unit) = 300mm');
  assert(uNone.unit === '', 'no unit detected');
}

// null/invalid
assert(parseLength(null) === null, 'parseLength(null) = null');
assert(parseLength('') === null, 'parseLength("") = null');
assert(parseLength('abc') === null, 'parseLength("abc") = null');

// ─── TEST: VIEWBOX SCALING ───────────────────────────────────────

console.log('\n=== Test: ViewBox Scaling ===');

// ViewBox + mm dimensions: scale applies
const svgScaled = `
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 400 200">
  <rect x="100" y="50" width="200" height="100"/>
</svg>`;

const sceneScaled = importSVG(svgScaled);
assertClose(sceneScaled.canvas.width, 100, 0.01, 'Scaled: canvas 100mm');
assertClose(sceneScaled.canvas.height, 50, 0.01, 'Scaled: canvas 50mm');

// The rect at viewBox coords (100,50) should be scaled by 100/400 = 0.25
const scaledRect = sceneScaled.objects[0];
// transform.a should be 0.25 (scale factor from viewBox)
assertClose(scaledRect.transform.a, 0.25, 0.001, 'Scaled: transform.a = 0.25');
assertClose(scaledRect.transform.d, 0.25, 0.001, 'Scaled: transform.d = 0.25');

// ViewBox only (no width/height): assume 1 unit = 1mm
const svgVBOnly = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 100">
  <circle cx="75" cy="50" r="25"/>
</svg>`;

const sceneVB = importSVG(svgVBOnly);
assertClose(sceneVB.canvas.width, 150, 0.01, 'ViewBox only: canvas 150mm');
assertClose(sceneVB.canvas.height, 100, 0.01, 'ViewBox only: canvas 100mm');
// Identity transform (no scaling)
assertClose(sceneVB.objects[0].transform.a, 1, 0.001, 'ViewBox only: no scale');

// ViewBox with offset: translates content
const svgVBOffset = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="50 50 100 100">
  <rect x="75" y="75" width="50" height="50"/>
</svg>`;

const sceneVBO = importSVG(svgVBOffset);
// Root transform should translate by (-50, -50) to shift viewBox origin to (0,0)
assertClose(sceneVBO.objects[0].transform.tx, -50, 0.01, 'ViewBox offset: tx = -50');
assertClose(sceneVBO.objects[0].transform.ty, -50, 0.01, 'ViewBox offset: ty = -50');

// Explicit px dimensions: converted to mm
const svgPx = `
<svg xmlns="http://www.w3.org/2000/svg" width="960px" height="960px">
  <rect x="0" y="0" width="100" height="100"/>
</svg>`;

const scenePx = importSVG(svgPx);
assertClose(scenePx.canvas.width, 254, 1, 'px dims: 960px = ~254mm');
// Objects should be scaled from px to mm
const pxScale = 25.4 / 96;
assertClose(scenePx.objects[0].transform.a, pxScale, 0.001, 'px dims: objects scaled to mm');

// ─── TEST: BOUNDS AFTER ROOT TRANSFORM ───────────────────────────

console.log('\n=== Test: Bounds After Root Transform ===');

import { computeSceneBounds, computeObjectBounds } from '../src/geometry/bounds';

// SVG with viewBox scaling: 400x200 viewBox → 100x50mm physical
// Rect at viewBox coords (100, 50, 200, 100) should become (25, 12.5, 50, 25) in mm
const svgBoundsTest = `
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 400 200">
  <rect x="100" y="50" width="200" height="100"/>
</svg>`;

const sceneBT = importSVG(svgBoundsTest);
const objBT = sceneBT.objects[0];

// Object transform should be the 0.25 scale from viewBox
assertClose(objBT.transform.a, 0.25, 0.001, 'BoundsTest: transform.a = 0.25');

// computeObjectBounds must apply the transform
const objBounds = computeObjectBounds(objBT);
// Local rect (100,50)→(300,150), scaled by 0.25 → (25,12.5)→(75,37.5) in mm
assertClose(objBounds.minX, 25, 0.01, 'BoundsTest: obj minX = 25mm (not 100)');
assertClose(objBounds.minY, 12.5, 0.01, 'BoundsTest: obj minY = 12.5mm (not 50)');
assertClose(objBounds.maxX, 75, 0.01, 'BoundsTest: obj maxX = 75mm (not 300)');
assertClose(objBounds.maxY, 37.5, 0.01, 'BoundsTest: obj maxY = 37.5mm (not 150)');

// computeSceneBounds must also be in mm
const sceneBounds = computeSceneBounds(sceneBT);
assertClose(sceneBounds.minX, 25, 0.01, 'BoundsTest: scene minX = 25mm');
assertClose(sceneBounds.maxX, 75, 0.01, 'BoundsTest: scene maxX = 75mm');

// Verify this would be WRONG without transform:
// If bounds used local coords directly, we'd get minX=100, maxX=300
assert(objBounds.minX < 100, 'BoundsTest: proves transform is applied (minX < 100)');
assert(objBounds.maxX < 300, 'BoundsTest: proves transform is applied (maxX < 300)');

console.log(`  ℹ Object bounds: (${objBounds.minX.toFixed(1)}, ${objBounds.minY.toFixed(1)}) → (${objBounds.maxX.toFixed(1)}, ${objBounds.maxY.toFixed(1)}) mm`);

// ─── TEST: ARC SUBDIVISION ───────────────────────────────────────

console.log('\n=== Test: Arc Subdivision ===');

// Small radius arc should produce more segments than large radius
const smallArc = parsePathData('M 0 0 A 2 2 0 1 1 4 0');  // r=2mm, semicircle
const largeArc = parsePathData('M 0 0 A 50 50 0 1 1 100 0'); // r=50mm, semicircle

const smallSegs = smallArc.subPaths[0].segments.filter(s => s.type === 'cubic');
const largeSegs = largeArc.subPaths[0].segments.filter(s => s.type === 'cubic');

assert(smallSegs.length >= largeSegs.length,
  `Small arc: ${smallSegs.length} cubics ≥ large arc: ${largeSegs.length} cubics`);
assert(smallSegs.length >= 3, `Small arc (r=2mm): ≥3 cubic segments (got ${smallSegs.length})`);

// Full circle arc should have at least 4 segments
const fullCircle = parsePathData('M 10 0 A 10 10 0 1 1 10 0.001');
const circleSegs = fullCircle.subPaths[0].segments.filter(s => s.type === 'cubic');
assert(circleSegs.length >= 4, `Full circle: ≥4 segments (got ${circleSegs.length})`);

// ─── RESULTS ─────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
