/**
 * === FILE: /tests/viewport.test.ts ===
 *
 * Purpose:    Tests for viewport coordinate math: screen↔world
 *             transforms, zoom-at-point, pan, fit-to-bounds.
 *             These are the foundation of all canvas interaction —
 *             if they're wrong, nothing renders correctly.
 *
 * Dependencies: /src/ui/viewport.ts
 * Last updated: Phase 1 (UI), Step 3 — Canvas viewport
 *
 * Run with: npx tsx tests/viewport.test.ts
 */

import {
  type ViewportState,
  DEFAULT_VIEWPORT,
  Transform,
  screenToWorld,
  worldToScreen,
  worldToScreenDist,
  screenToWorldDist,
  zoomAt,
  pan,
  fitToBounds,
  fitToAABB,
  wheelToZoomFactor,
} from '../src/ui/viewport';

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
  assert(
    Math.abs(actual - expected) < tol,
    `${msg} (got ${actual.toFixed(4)}, expected ${expected})`
  );
}

// ─── TEST: SCREEN ↔ WORLD ROUND TRIP ─────────────────────────────

console.log('\n=== Test: Screen ↔ World Round Trip ===');

// Identity-like viewport: zoom=1, no offset
const identity: ViewportState = { offsetX: 0, offsetY: 0, zoom: 1 };

// At zoom=1, offset=0: screen and world are the same
const w1 = screenToWorld(100, 200, identity);
assertClose(w1.x, 100, 0.001, 'Identity: screenToWorld X');
assertClose(w1.y, 200, 0.001, 'Identity: screenToWorld Y');

const s1 = worldToScreen(100, 200, identity);
assertClose(s1.x, 100, 0.001, 'Identity: worldToScreen X');
assertClose(s1.y, 200, 0.001, 'Identity: worldToScreen Y');

// With zoom=2, offset=0: 1mm = 2px
const zoomed: ViewportState = { offsetX: 0, offsetY: 0, zoom: 2 };

const w2 = screenToWorld(200, 400, zoomed);
assertClose(w2.x, 100, 0.001, 'Zoom 2x: screen 200px → world 100mm');
assertClose(w2.y, 200, 0.001, 'Zoom 2x: screen 400px → world 200mm');

const s2 = worldToScreen(100, 200, zoomed);
assertClose(s2.x, 200, 0.001, 'Zoom 2x: world 100mm → screen 200px');
assertClose(s2.y, 400, 0.001, 'Zoom 2x: world 200mm → screen 400px');

// With offset: shift everything
const offset: ViewportState = { offsetX: 50, offsetY: 30, zoom: 1 };

const w3 = screenToWorld(150, 230, offset);
assertClose(w3.x, 100, 0.001, 'Offset: screen 150px → world 100mm (offset 50)');
assertClose(w3.y, 200, 0.001, 'Offset: screen 230px → world 200mm (offset 30)');

// Round trip: world → screen → world should return original point
const vp: ViewportState = { offsetX: 37.5, offsetY: 42.3, zoom: 2.7 };
const original = { x: 123.456, y: 78.901 };
const screen = worldToScreen(original.x, original.y, vp);
const roundTrip = screenToWorld(screen.x, screen.y, vp);
assertClose(roundTrip.x, original.x, 0.001, 'Round trip X preserved');
assertClose(roundTrip.y, original.y, 0.001, 'Round trip Y preserved');

// Distance conversions
assertClose(worldToScreenDist(10, zoomed), 20, 0.001, 'World 10mm → screen 20px at zoom 2x');
assertClose(screenToWorldDist(20, zoomed), 10, 0.001, 'Screen 20px → world 10mm at zoom 2x');

// ─── TEST: ZOOM AT POINT ─────────────────────────────────────────

console.log('\n=== Test: Zoom At Point ===');

// Zoom in 2x centered at screen origin (0,0)
const vp1: ViewportState = { offsetX: 0, offsetY: 0, zoom: 1 };
const z1 = zoomAt(vp1, 0, 0, 2);
assertClose(z1.zoom, 2, 0.001, 'Zoom factor 2x applied');
assertClose(z1.offsetX, 0, 0.001, 'Zoom at origin: offsetX unchanged');
assertClose(z1.offsetY, 0, 0.001, 'Zoom at origin: offsetY unchanged');

// Key invariant: the world point under the cursor stays fixed.
// Zoom 2x at screen point (200, 150)
const vp2: ViewportState = { offsetX: 40, offsetY: 40, zoom: 1.5 };
const anchorSx = 200, anchorSy = 150;

// World point under cursor before zoom
const beforeWorld = screenToWorld(anchorSx, anchorSy, vp2);

// Zoom in
const vp2z = zoomAt(vp2, anchorSx, anchorSy, 1.5);

// World point under cursor after zoom
const afterWorld = screenToWorld(anchorSx, anchorSy, vp2z);

assertClose(afterWorld.x, beforeWorld.x, 0.001, 'Zoom anchor: world X unchanged under cursor');
assertClose(afterWorld.y, beforeWorld.y, 0.001, 'Zoom anchor: world Y unchanged under cursor');

// Zoom should clamp to limits
const zMax = zoomAt({ offsetX: 0, offsetY: 0, zoom: 45 }, 0, 0, 2);
assert(zMax.zoom <= 50, 'Zoom clamped to max 50');

const zMin = zoomAt({ offsetX: 0, offsetY: 0, zoom: 0.06 }, 0, 0, 0.5);
assert(zMin.zoom >= 0.05, 'Zoom clamped to min 0.05');

// ─── TEST: PAN ───────────────────────────────────────────────────

console.log('\n=== Test: Pan ===');

const vp3: ViewportState = { offsetX: 100, offsetY: 50, zoom: 2 };
const panned = pan(vp3, -30, 20);
assertClose(panned.offsetX, 70, 0.001, 'Pan: offsetX decreased by 30');
assertClose(panned.offsetY, 70, 0.001, 'Pan: offsetY increased by 20');
assertClose(panned.zoom, 2, 0.001, 'Pan: zoom unchanged');

// Pan preserves world coordinates: point at screen (0,0) before pan
// should be at screen (-30, 20) after pan(-30, 20)
const worldBefore = screenToWorld(0, 0, vp3);
const worldAfterPan = screenToWorld(-30, 20, panned);
assertClose(worldAfterPan.x, worldBefore.x, 0.001, 'Pan: same world point found at shifted screen pos');

// ─── TEST: FIT TO BOUNDS ─────────────────────────────────────────

console.log('\n=== Test: Fit To Bounds ===');

// Fit a 400×300 bed into an 800×600 canvas with 40px padding
const fit1 = fitToBounds(0, 0, 400, 300, 800, 600, 40);

// Zoom should fit the bed into the available space
assert(fit1.zoom > 0, `Fit zoom is positive (${fit1.zoom.toFixed(3)})`);

// All four corners should be visible on screen
const topLeft = worldToScreen(0, 0, fit1);
const bottomRight = worldToScreen(400, 300, fit1);

assert(topLeft.x >= 0, `Fit: top-left X on screen (${topLeft.x.toFixed(1)})`);
assert(topLeft.y >= 0, `Fit: top-left Y on screen (${topLeft.y.toFixed(1)})`);
assert(bottomRight.x <= 800, `Fit: bottom-right X on screen (${bottomRight.x.toFixed(1)})`);
assert(bottomRight.y <= 600, `Fit: bottom-right Y on screen (${bottomRight.y.toFixed(1)})`);

// Bed should be centered
const bedScreenW = bottomRight.x - topLeft.x;
const bedScreenH = bottomRight.y - topLeft.y;
const marginX = (800 - bedScreenW) / 2;
const marginY = (600 - bedScreenH) / 2;
assertClose(topLeft.x, marginX, 1, 'Fit: horizontally centered');
assertClose(topLeft.y, marginY, 1, 'Fit: vertically centered');

// Fit a tall narrow bed (100×800 into 800×600)
const fit2 = fitToBounds(0, 0, 100, 800, 800, 600, 40);
// Height-constrained: zoom should be based on height
const expectedZoom2 = (600 - 80) / 800; // 0.65
assertClose(fit2.zoom, expectedZoom2, 0.01, `Tall bed: zoom = ${expectedZoom2.toFixed(3)} (height-limited)`);

// ─── TEST: FIT TO AABB ──────────────────────────────────────────

console.log('\n=== Test: Fit To AABB ===');

// Basic: fit a 100×100 box centered at (50,50) into 800×600 canvas
const aabb1 = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const fitA1 = fitToAABB(aabb1, 800, 600, 0.1);

assert(fitA1.zoom > 0, `fitToAABB: zoom is positive (${fitA1.zoom.toFixed(3)})`);

// All corners with padding should be visible
const a1TL = worldToScreen(-10, -10, fitA1);  // 10% padding = 10mm
const a1BR = worldToScreen(110, 110, fitA1);
assert(a1TL.x >= 0, `fitToAABB: padded top-left X on screen (${a1TL.x.toFixed(1)})`);
assert(a1TL.y >= 0, `fitToAABB: padded top-left Y on screen (${a1TL.y.toFixed(1)})`);
assert(a1BR.x <= 800, `fitToAABB: padded bottom-right X on screen (${a1BR.x.toFixed(1)})`);
assert(a1BR.y <= 600, `fitToAABB: padded bottom-right Y on screen (${a1BR.y.toFixed(1)})`);

// Content should be centered
const a1CenterScreen = worldToScreen(50, 50, fitA1);
assertClose(a1CenterScreen.x, 400, 1, 'fitToAABB: content centered horizontally');
assertClose(a1CenterScreen.y, 300, 1, 'fitToAABB: content centered vertically');

// Edge case: invalid AABB → returns default viewport
const infiniteAABB = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
const fitInvalid = fitToAABB(infiniteAABB, 800, 600);
assert(fitInvalid.zoom === DEFAULT_VIEWPORT.zoom, 'fitToAABB: invalid bounds → default viewport');

// Edge case: zero-size AABB → returns default viewport
const zeroAABB = { minX: 50, minY: 50, maxX: 50, maxY: 50 };
const fitZero = fitToAABB(zeroAABB, 800, 600);
assert(fitZero.zoom === DEFAULT_VIEWPORT.zoom, 'fitToAABB: zero-size bounds → default viewport');

// Small content in big canvas should zoom in more than big content
const smallBox = { minX: 40, minY: 40, maxX: 60, maxY: 60 };
const bigBox = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
const fitSmall = fitToAABB(smallBox, 800, 600, 0.1);
const fitBig = fitToAABB(bigBox, 800, 600, 0.1);
assert(fitSmall.zoom > fitBig.zoom, `Small content → higher zoom (${fitSmall.zoom.toFixed(1)} > ${fitBig.zoom.toFixed(1)})`);

// ─── TEST: WHEEL ZOOM FACTOR ─────────────────────────────────────

console.log('\n=== Test: Wheel Zoom Factor ===');

const factorIn = wheelToZoomFactor(-100); // Scroll up = zoom in
assert(factorIn > 1, `Scroll up: zoom in (factor ${factorIn.toFixed(3)})`);

const factorOut = wheelToZoomFactor(100);  // Scroll down = zoom out
assert(factorOut < 1, `Scroll down: zoom out (factor ${factorOut.toFixed(3)})`);

assertClose(factorIn * factorOut, 1, 0.001, 'In × Out ≈ 1 (symmetric)');

// ─── TEST: EXTREME VALUES ────────────────────────────────────────

console.log('\n=== Test: Extreme Values ===');

// Very high zoom
const hiZoom: ViewportState = { offsetX: 0, offsetY: 0, zoom: 50 };
const whi = screenToWorld(500, 500, hiZoom);
assertClose(whi.x, 10, 0.001, 'High zoom: 500px → 10mm at 50x');

// Very low zoom
const loZoom: ViewportState = { offsetX: 0, offsetY: 0, zoom: 0.1 };
const wlo = screenToWorld(50, 50, loZoom);
assertClose(wlo.x, 500, 0.001, 'Low zoom: 50px → 500mm at 0.1x');

// Negative offsets (panned past origin)
const negOff: ViewportState = { offsetX: -100, offsetY: -200, zoom: 1 };
const wn = screenToWorld(0, 0, negOff);
assertClose(wn.x, 100, 0.001, 'Negative offset: screen origin = world 100mm');
assertClose(wn.y, 200, 0.001, 'Negative offset: screen origin = world 200mm');

// ─── TEST: TRANSFORM OBJECT ─────────────────────────────────────

console.log('\n=== Test: Transform Object ===');

// Transform.from creates from ViewportState
const tf = Transform.from({ offsetX: 50, offsetY: 30, zoom: 2 });
assert(tf.zoom === 2, 'Transform.zoom returns zoom');

// worldToScreen matches free function
const tfScreen = tf.worldToScreen({ x: 100, y: 200 });
const freeScreen = worldToScreen(100, 200, { offsetX: 50, offsetY: 30, zoom: 2 });
assertClose(tfScreen.x, freeScreen.x, 0.001, 'Transform.worldToScreen matches free function X');
assertClose(tfScreen.y, freeScreen.y, 0.001, 'Transform.worldToScreen matches free function Y');

// screenToWorld matches free function
const tfWorld = tf.screenToWorld({ x: 250, y: 430 });
const freeWorld = screenToWorld(250, 430, { offsetX: 50, offsetY: 30, zoom: 2 });
assertClose(tfWorld.x, freeWorld.x, 0.001, 'Transform.screenToWorld matches free function X');
assertClose(tfWorld.y, freeWorld.y, 0.001, 'Transform.screenToWorld matches free function Y');

// Round trip via Transform
const origPt = { x: 77.77, y: 33.33 };
const rt = tf.screenToWorld(tf.worldToScreen(origPt));
assertClose(rt.x, origPt.x, 0.001, 'Transform round trip X');
assertClose(rt.y, origPt.y, 0.001, 'Transform round trip Y');

// screenPx replaces N / zoom pattern
assertClose(tf.screenPx(1.2), 1.2 / 2, 0.001, 'screenPx(1.2) = 0.6 at zoom 2');
assertClose(tf.screenPx(6), 6 / 2, 0.001, 'screenPx(6) = 3 at zoom 2');

const tf2 = Transform.from({ offsetX: 0, offsetY: 0, zoom: 0.5 });
assertClose(tf2.screenPx(1), 2, 0.001, 'screenPx(1) = 2 at zoom 0.5');

// getVisibleWorldBounds
const tfVis = Transform.from({ offsetX: 0, offsetY: 0, zoom: 1 });
const vis1 = tfVis.getVisibleWorldBounds(800, 600);
assertClose(vis1.minX, 0, 0.001, 'VisibleBounds: minX = 0 at identity');
assertClose(vis1.minY, 0, 0.001, 'VisibleBounds: minY = 0 at identity');
assertClose(vis1.maxX, 800, 0.001, 'VisibleBounds: maxX = 800 at zoom 1');
assertClose(vis1.maxY, 600, 0.001, 'VisibleBounds: maxY = 600 at zoom 1');

// With zoom=2, visible world area halves
const tfVis2 = Transform.from({ offsetX: 0, offsetY: 0, zoom: 2 });
const vis2 = tfVis2.getVisibleWorldBounds(800, 600);
assertClose(vis2.maxX, 400, 0.001, 'VisibleBounds: maxX = 400 at zoom 2');
assertClose(vis2.maxY, 300, 0.001, 'VisibleBounds: maxY = 300 at zoom 2');

// With offset, visible area shifts
const tfVis3 = Transform.from({ offsetX: -100, offsetY: -50, zoom: 1 });
const vis3 = tfVis3.getVisibleWorldBounds(800, 600);
assertClose(vis3.minX, 100, 0.001, 'VisibleBounds: shifted minX = 100');
assertClose(vis3.minY, 50, 0.001, 'VisibleBounds: shifted minY = 50');
assertClose(vis3.maxX, 900, 0.001, 'VisibleBounds: shifted maxX = 900');
assertClose(vis3.maxY, 650, 0.001, 'VisibleBounds: shifted maxY = 650');

// ─── RESULTS ─────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
