/**
 * === FILE: /tests/svg-import-placement.test.ts ===
 *
 * Purpose:    Tests for SVG import placement: centering, fit/fill
 *             scaling, aspect ratio preservation, transform composition,
 *             and immutability guarantees.
 *
 * Run with: npx tsx tests/svg-import-placement.test.ts
 */

import {
  computeImportTransform,
  applyTransformToObjects,
  type ImportOptions,
} from '../src/io/SvgImportPlacement';
import { importSvgIntoScene } from '../src/import/svg/SvgToScene';
import { createScene } from '../src/core/scene/Scene';
import { createRect, createEllipse } from '../src/core/scene/SceneObject';
import { type AABB, type Matrix3x2, IDENTITY_MATRIX } from '../src/core/types';
import { computeSceneBounds, computeObjectBounds } from '../src/geometry/bounds';
import { addObject, addObjects } from '../src/ui/history/SceneCommands';
import { multiplyMatrix } from '../src/import/svg/TransformParser';

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

// ─── TEST: CENTERING (ORIGINAL MODE) ─────────────────────────────

console.log('\n=== Test: Centering (Original Mode) ===');

{
  // Source: 100×50 content at (0,0)→(100,50)
  const source: AABB = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
  // Target: 400×300 canvas
  const target: AABB = { minX: 0, minY: 0, maxX: 400, maxY: 300 };

  const t = computeImportTransform(source, target, { mode: 'original' });

  // Scale should be 1 (no scaling)
  assertClose(t.a, 1, 0.001, 'Original: no scale X');
  assertClose(t.d, 1, 0.001, 'Original: no scale Y');

  // Source center (50, 25) should map to target center (200, 150)
  // tx = 200 - 50*1 = 150, ty = 150 - 25*1 = 125
  assertClose(t.tx, 150, 0.001, 'Original: center tx = 150');
  assertClose(t.ty, 125, 0.001, 'Original: center ty = 125');

  // Verify: source center after transform = target center
  const srcCx = 50, srcCy = 25;
  assertClose(t.a * srcCx + t.tx, 200, 0.001, 'Original: source center → target center X');
  assertClose(t.d * srcCy + t.ty, 150, 0.001, 'Original: source center → target center Y');
}

// ─── TEST: FIT MODE (SCALE DOWN) ─────────────────────────────────

console.log('\n=== Test: Fit Mode (Scale Down) ===');

{
  // Large source: 1000×500 → small target: 200×200 with 10% padding
  const source: AABB = { minX: 0, minY: 0, maxX: 1000, maxY: 500 };
  const target: AABB = { minX: 0, minY: 0, maxX: 200, maxY: 200 };

  const t = computeImportTransform(source, target, {
    mode: 'fit', padding: 0.1, preserveAspect: true,
  });

  // Available space: 200 * 0.8 = 160 in each axis
  // scaleX = 160/1000 = 0.16, scaleY = 160/500 = 0.32
  // fit = min(0.16, 0.32) = 0.16
  assertClose(t.a, 0.16, 0.001, 'Fit: scale = 0.16 (width-limited)');
  assertClose(t.d, 0.16, 0.001, 'Fit: uniform scale (aspect preserved)');

  // Verify all corners are inside target
  const corners = [
    { x: 0, y: 0 }, { x: 1000, y: 0 },
    { x: 1000, y: 500 }, { x: 0, y: 500 },
  ];
  for (const c of corners) {
    const wx = t.a * c.x + t.tx;
    const wy = t.d * c.y + t.ty;
    assert(wx >= 0 && wx <= 200, `Fit: corner (${c.x},${c.y}) X inside target (${wx.toFixed(1)})`);
    assert(wy >= 0 && wy <= 200, `Fit: corner (${c.x},${c.y}) Y inside target (${wy.toFixed(1)})`);
  }
}

// ─── TEST: FIT MODE (SCALE UP) ───────────────────────────────────

console.log('\n=== Test: Fit Mode (Scale Up) ===');

{
  // Small source into large target
  const source: AABB = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
  const target: AABB = { minX: 0, minY: 0, maxX: 400, maxY: 300 };

  const t = computeImportTransform(source, target, {
    mode: 'fit', padding: 0.1, allowScaleUp: true,
  });

  // Available: 320×240, source 20×20 → min(16, 12) = 12
  assertClose(t.a, 12, 0.001, 'Fit up: scale = 12 (height-limited)');
  assertClose(t.d, 12, 0.001, 'Fit up: uniform scale');
}

// ─── TEST: SAFE IMPORT — DEFAULT NO SCALE UP ────────────────────

console.log('\n=== Test: Safe Import — Default No Scale Up ===');

{
  // Small source (50×30) into large target (400×300)
  // Default allowScaleUp=false → should NOT scale up
  const source: AABB = { minX: 0, minY: 0, maxX: 50, maxY: 30 };
  const target: AABB = { minX: 0, minY: 0, maxX: 400, maxY: 300 };

  const t = computeImportTransform(source, target, { mode: 'fit', padding: 0 });
  assertClose(t.a, 1, 0.001, 'Safe import: scale capped at 1 (not 6)');
  assertClose(t.d, 1, 0.001, 'Safe import: uniform scale capped');

  // But should still be centered
  const cx = t.a * 25 + t.tx;
  const cy = t.d * 15 + t.ty;
  assertClose(cx, 200, 0.01, 'Safe import: centered X');
  assertClose(cy, 150, 0.01, 'Safe import: centered Y');

  // Large source (800×600) should still scale DOWN
  const srcLarge: AABB = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  const tDown = computeImportTransform(srcLarge, target, { mode: 'fit', padding: 0 });
  assertClose(tDown.a, 0.5, 0.01, 'Safe import: scales down when needed');

  // allowScaleUp: true overrides the cap
  const tUp = computeImportTransform(source, target, {
    mode: 'fit', padding: 0, allowScaleUp: true,
  });
  assertClose(tUp.a, 8, 0.01, 'allowScaleUp=true: scales up to 8');
}

// ─── TEST: FILL MODE ─────────────────────────────────────────────

console.log('\n=== Test: Fill Mode ===');

{
  // Source 200×100 → target 200×200 with 10% padding
  const source: AABB = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
  const target: AABB = { minX: 0, minY: 0, maxX: 200, maxY: 200 };

  const t = computeImportTransform(source, target, {
    mode: 'fill', padding: 0.1, allowScaleUp: true,
  });

  // Available: 160×160
  // scaleX = 160/200 = 0.8, scaleY = 160/100 = 1.6
  // fill = max(0.8, 1.6) = 1.6
  assertClose(t.a, 1.6, 0.001, 'Fill: scale = 1.6 (max)');
  assertClose(t.d, 1.6, 0.001, 'Fill: uniform scale');

  // In fill mode, content overflows at least one axis
  // Scaled width: 200 * 1.6 = 320 > target 200
  const scaledW = 200 * t.a;
  assert(scaledW > 200, `Fill: content overflows X (${scaledW.toFixed(0)} > 200)`);
}

// ─── TEST: ASPECT RATIO PRESERVED ────────────────────────────────

console.log('\n=== Test: Aspect Ratio Preservation ===');

{
  // Rectangular source 300×100 into square target 200×200
  const source: AABB = { minX: 0, minY: 0, maxX: 300, maxY: 100 };
  const target: AABB = { minX: 0, minY: 0, maxX: 200, maxY: 200 };

  const tFit = computeImportTransform(source, target, {
    mode: 'fit', preserveAspect: true, padding: 0,
  });

  // With aspect: scale = min(200/300, 200/100) = min(0.667, 2) = 0.667
  assertClose(tFit.a, 0.667, 0.01, 'Aspect fit: sx = sy (uniform)');
  assertClose(tFit.d, 0.667, 0.01, 'Aspect fit: sy = sx');

  // Without aspect ratio: independent scaling
  const tStretch = computeImportTransform(source, target, {
    mode: 'fit', preserveAspect: false, padding: 0, allowScaleUp: true,
  });

  assertClose(tStretch.a, 200 / 300, 0.01, 'No aspect: sx = 200/300');
  assertClose(tStretch.d, 200 / 100, 0.01, 'No aspect: sy = 200/100');
  assert(tStretch.a !== tStretch.d, 'No aspect: sx ≠ sy (non-uniform)');
}

// ─── TEST: TRANSFORM COMPOSITION ─────────────────────────────────

console.log('\n=== Test: Transform Composition ===');

{
  // Object with existing rotation transform
  const rotatedObj = {
    ...createRect('layer-1', 0, 0, 50, 50, 'Rotated'),
    transform: { a: 0.707, b: 0.707, c: -0.707, d: 0.707, tx: 25, ty: 25 } as Matrix3x2,
  };

  const importT: Matrix3x2 = { a: 2, b: 0, c: 0, d: 2, tx: 100, ty: 50 };
  const result = applyTransformToObjects([rotatedObj], importT);

  assert(result.length === 1, 'Compose: 1 object');

  // Result transform = importT × objectT
  const expected = multiplyMatrix(importT, rotatedObj.transform);
  const rt = result[0].transform;
  assertClose(rt.a, expected.a, 0.001, 'Compose: a correct');
  assertClose(rt.b, expected.b, 0.001, 'Compose: b correct');
  assertClose(rt.c, expected.c, 0.001, 'Compose: c correct');
  assertClose(rt.d, expected.d, 0.001, 'Compose: d correct');
  assertClose(rt.tx, expected.tx, 0.001, 'Compose: tx correct');
  assertClose(rt.ty, expected.ty, 0.001, 'Compose: ty correct');
}

// ─── TEST: NO MUTATION ───────────────────────────────────────────

console.log('\n=== Test: No Mutation ===');

{
  const original = createRect('layer-1', 30, 40, 50, 50, 'NoMutate');
  const origTx = original.transform.tx;
  const origTy = original.transform.ty;

  const importT: Matrix3x2 = { a: 3, b: 0, c: 0, d: 3, tx: 200, ty: 100 };
  const result = applyTransformToObjects([original], importT);

  // Original must be untouched
  assert(original.transform.tx === origTx, 'NoMutate: original tx unchanged');
  assert(original.transform.ty === origTy, 'NoMutate: original ty unchanged');

  // Result is a different object
  assert(result[0] !== original, 'NoMutate: result is new reference');
  assert(result[0].transform !== original.transform, 'NoMutate: transform is new reference');
}

// ─── TEST: IDENTITY TRANSFORM ────────────────────────────────────

console.log('\n=== Test: Identity Transform ===');

{
  const obj = createRect('layer-1', 10, 10, 50, 50);
  const result = applyTransformToObjects([obj], { ...IDENTITY_MATRIX });

  // Identity should produce new array but preserve object content
  assert(result.length === 1, 'Identity: 1 object');
  assertClose(result[0].transform.tx, obj.transform.tx, 0.001, 'Identity: tx unchanged');
}

// ─── TEST: OFFSET SOURCE BOUNDS ──────────────────────────────────

console.log('\n=== Test: Offset Source Bounds ===');

{
  // Source not at origin: content at (200, 300)→(400, 500)
  const source: AABB = { minX: 200, minY: 300, maxX: 400, maxY: 500 };
  const target: AABB = { minX: 0, minY: 0, maxX: 400, maxY: 300 };

  const t = computeImportTransform(source, target, { mode: 'original' });

  // Source center (300, 400) should map to target center (200, 150)
  const mappedX = t.a * 300 + t.tx;
  const mappedY = t.d * 400 + t.ty;
  assertClose(mappedX, 200, 0.001, 'Offset: source center X → target center X');
  assertClose(mappedY, 150, 0.001, 'Offset: source center Y → target center Y');
}

// ─── TEST: FULL SVG IMPORT WITH PLACEMENT ────────────────────────

console.log('\n=== Test: Full SVG Import With Placement ===');

{
  // Create a 400×300 scene
  const scene = createScene(400, 300, 'Placement Test');
  const layerId = scene.layers[0].id;

  // SVG with content at 0,0 → 100,100
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="0" y="0" width="100" height="100"/>
    </svg>`;

  // Import with fit mode
  const result = importSvgIntoScene(svg, scene, layerId, {
    mode: 'fit', padding: 0.1,
  });

  assert(result.objects.length === 1, 'SVG placement: 1 object imported');

  // Verify the object is within canvas bounds
  const objBounds = computeObjectBounds(result.objects[0]);
  assert(objBounds.minX >= 0, `SVG placement: minX ≥ 0 (${objBounds.minX.toFixed(1)})`);
  assert(objBounds.minY >= 0, `SVG placement: minY ≥ 0 (${objBounds.minY.toFixed(1)})`);
  assert(objBounds.maxX <= 400, `SVG placement: maxX ≤ 400 (${objBounds.maxX.toFixed(1)})`);
  assert(objBounds.maxY <= 300, `SVG placement: maxY ≤ 300 (${objBounds.maxY.toFixed(1)})`);

  // Verify centering: object center should be near canvas center
  const objCx = (objBounds.minX + objBounds.maxX) / 2;
  const objCy = (objBounds.minY + objBounds.maxY) / 2;
  assertClose(objCx, 200, 1, 'SVG placement: centered X');
  assertClose(objCy, 150, 1, 'SVG placement: centered Y');
}

// ─── TEST: IMPORT WITHOUT OPTIONS (BACKWARD COMPAT) ──────────────

console.log('\n=== Test: Import Without Options ===');

{
  const scene = createScene(400, 300);
  const layerId = scene.layers[0].id;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><circle cx="25" cy="25" r="10"/></svg>`;

  // No options → objects placed at original SVG coordinates (no transform)
  const result = importSvgIntoScene(svg, scene, layerId);
  assert(result.objects.length === 1, 'No options: 1 object');

  // Object should be at original SVG coordinates
  const obj = result.objects[0];
  if (obj.geometry.type === 'ellipse') {
    assertClose(obj.geometry.cx, 25, 0.001, 'No options: geometry at original coords');
  }
}

// ─── TEST: EMPTY SVG WITH PLACEMENT ──────────────────────────────

console.log('\n=== Test: Empty SVG With Placement ===');

{
  const scene = createScene(400, 300);
  const layerId = scene.layers[0].id;

  const result = importSvgIntoScene(
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    scene, layerId, { mode: 'fit' }
  );

  assert(result.objects.length === 0, 'Empty SVG: no objects added');
  assert(result === scene, 'Empty SVG: scene unchanged (same reference)');
}

// ─── RESULTS ─────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
