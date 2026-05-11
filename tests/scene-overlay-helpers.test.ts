/**
 * T1-132: regression test for the pure overlay-bounds helpers
 * extracted from `src/ui/renderers/SceneRenderer.ts`. Pre-T1-132 these
 * five helpers lived as private top-level functions inside the
 * 1381-line renderer module; testing them required loading the
 * canvas-side dependencies. Post-T1-132 they live in
 * `src/ui/renderers/sceneOverlayHelpers.ts` and can be exercised
 * standalone with no DOM.
 *
 * This test pins:
 *   - `computeSceneBounds` honors per-object visibility, ignores
 *     non-finite bounds, and returns the {0,0,0,0} sentinel for an
 *     empty scene.
 *   - `hasSceneBounds` requires non-degenerate extents.
 *   - `positiveFinite` rejects 0, negatives, NaN, undefined.
 *   - `resolveBedOriginMarker` returns the corner with the smallest
 *     machine-coord magnitude AND null when right-origin needs
 *     bedWidthMm but it's missing.
 *   - `resolveMachineOriginMarker` dispatches by start mode and
 *     short-circuits on missing inputs.
 *   - Source-pin: SceneRenderer imports the helpers AND the inline
 *     definitions are gone.
 *
 * Run: npx tsx tests/scene-overlay-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';
import {
  DEFAULT_MACHINE_OVERLAY_BED_HEIGHT_MM,
  computeSceneBounds,
  hasSceneBounds,
  positiveFinite,
  resolveBedOriginMarker,
  resolveMachineOriginMarker,
} from '../src/ui/renderers/sceneOverlayHelpers';

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

function approxEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function makeRect(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  visible = true,
): SceneObject {
  return {
    id,
    layerId: 'l1',
    name: id,
    visible,
    locked: false,
    selected: false,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: {
      type: 'rect',
      x,
      y,
      width,
      height,
      cornerRadius: 0,
    },
    _bounds: null,
    _worldTransform: null,
  } as unknown as SceneObject;
}

function makeScene(objects: SceneObject[]): Scene {
  return {
    id: 's',
    version: 1,
    canvas: { width: 200, height: 200 } as never,
    objects,
    layers: [
      {
        id: 'l1',
        name: 'L1',
        color: '#ff0000',
        visible: true,
        locked: false,
        output: true,
        settings: {} as never,
      } as never,
    ],
    activeLayerId: 'l1',
    metadata: { name: 't' } as never,
  } as unknown as Scene;
}

console.log('\n=== T1-132 scene overlay helpers ===\n');

// -------- 1. computeSceneBounds — empty scene returns sentinel --------
{
  const r = computeSceneBounds(makeScene([]));
  assert(r.minX === 0 && r.minY === 0 && r.maxX === 0 && r.maxY === 0,
    'computeSceneBounds: empty scene → {0,0,0,0} sentinel');
}

// -------- 2. computeSceneBounds — single visible rect --------
{
  const r = computeSceneBounds(makeScene([makeRect('a', 10, 20, 30, 40)]));
  assert(r.minX === 10 && r.minY === 20 && r.maxX === 40 && r.maxY === 60,
    'computeSceneBounds: single rect produces correct AABB');
}

// -------- 3. computeSceneBounds — union of two visible rects --------
{
  const r = computeSceneBounds(makeScene([
    makeRect('a', 10, 10, 20, 20),
    makeRect('b', 50, 60, 30, 40),
  ]));
  assert(r.minX === 10 && r.minY === 10 && r.maxX === 80 && r.maxY === 100,
    'computeSceneBounds: union of two rects');
}

// -------- 4. computeSceneBounds — invisible objects are skipped --------
{
  const r = computeSceneBounds(makeScene([
    makeRect('a', 10, 10, 20, 20, true),
    makeRect('b', 200, 200, 30, 40, false),
  ]));
  assert(r.maxX === 30 && r.maxY === 30,
    'computeSceneBounds: invisible object NOT in union');
}

// -------- 5. computeSceneBounds — no visible bounds → sentinel --------
{
  const r = computeSceneBounds(makeScene([
    makeRect('a', 10, 10, 20, 20, false),
    makeRect('b', 200, 200, 30, 40, false),
  ]));
  assert(r.minX === 0 && r.maxX === 0,
    'computeSceneBounds: all invisible → {0,0,0,0} sentinel');
}

// -------- 6. hasSceneBounds — empty / degenerate / valid --------
{
  assert(!hasSceneBounds({ minX: 0, minY: 0, maxX: 0, maxY: 0 }),
    'hasSceneBounds: degenerate {0,0,0,0} → false');
  assert(!hasSceneBounds({ minX: 5, minY: 5, maxX: 5, maxY: 5 }),
    'hasSceneBounds: collapsed-to-point → false');
  assert(hasSceneBounds({ minX: 0, minY: 0, maxX: 10, maxY: 0 }),
    'hasSceneBounds: width-only positive (line along X) → true');
  assert(hasSceneBounds({ minX: 0, minY: 0, maxX: 0, maxY: 10 }),
    'hasSceneBounds: height-only positive (line along Y) → true');
  assert(hasSceneBounds({ minX: 0, minY: 0, maxX: 10, maxY: 20 }),
    'hasSceneBounds: positive width AND height → true');
  assert(!hasSceneBounds({ minX: NaN, minY: 0, maxX: 10, maxY: 10 }),
    'hasSceneBounds: NaN → false');
  assert(!hasSceneBounds({ minX: 0, minY: 0, maxX: Infinity, maxY: 10 }),
    'hasSceneBounds: Infinity → false');
}

// -------- 7. positiveFinite — every branch --------
{
  assert(positiveFinite(undefined) === null, 'positiveFinite: undefined → null');
  assert(positiveFinite(0) === null, 'positiveFinite: 0 → null (not strictly positive)');
  assert(positiveFinite(-5) === null, 'positiveFinite: negative → null');
  assert(positiveFinite(NaN) === null, 'positiveFinite: NaN → null');
  assert(positiveFinite(Infinity) === null, 'positiveFinite: Infinity → null');
  assert(positiveFinite(0.001) === 0.001, 'positiveFinite: small positive → value');
  assert(positiveFinite(300) === 300, 'positiveFinite: 300 → 300');
}

// -------- 8. resolveBedOriginMarker — default origin (front-left) --------
{
  const r = resolveBedOriginMarker({});
  assert(r != null, 'resolveBedOriginMarker: default options → non-null');
  // Default fallback bedHeight = 300; front-left origin maps to bed-Y=bedHeight in canvas.
  // The candidate that minimizes |machine| is the one whose machine coords are (0,0).
  // For front-left + Y-flip with bedHeight=300, canvas (0,300) is the machine origin.
  assert(approxEqual(r!.x, 0) && approxEqual(r!.y, DEFAULT_MACHINE_OVERLAY_BED_HEIGHT_MM),
    `resolveBedOriginMarker: front-left default → (0, ${DEFAULT_MACHINE_OVERLAY_BED_HEIGHT_MM})`);
  assert(r!.label === 'Bed origin', 'resolveBedOriginMarker: label is "Bed origin"');
}

// -------- 9. resolveBedOriginMarker — rear-left (no Y flip) --------
{
  const r = resolveBedOriginMarker({ originCorner: 'rear-left', bedHeightMm: 200 });
  assert(r != null, 'resolveBedOriginMarker: rear-left → non-null');
  // rear-left: no Y flip, canvas (0,0) = machine (0,0)
  assert(approxEqual(r!.x, 0) && approxEqual(r!.y, 0),
    'resolveBedOriginMarker: rear-left → canvas (0, 0)');
}

// -------- 10. resolveBedOriginMarker — right origin needs bedWidth --------
{
  assert(resolveBedOriginMarker({ originCorner: 'front-right' }) === null,
    'resolveBedOriginMarker: front-right without bedWidthMm → null');
  assert(resolveBedOriginMarker({ originCorner: 'rear-right' }) === null,
    'resolveBedOriginMarker: rear-right without bedWidthMm → null');
  assert(
    resolveBedOriginMarker({ originCorner: 'front-right', bedWidthMm: 0 }) === null,
    'resolveBedOriginMarker: bedWidthMm=0 still treated as missing (positiveFinite gate)',
  );
}

// -------- 11. resolveBedOriginMarker — front-right with bedWidth --------
{
  const r = resolveBedOriginMarker({
    originCorner: 'front-right',
    bedWidthMm: 400,
    bedHeightMm: 300,
  });
  assert(r != null, 'resolveBedOriginMarker: front-right + bedWidthMm → non-null');
  // front-right: X flipped AND Y flipped. Canvas (bedWidthMm, bedHeightMm) = machine (0,0).
  assert(approxEqual(r!.x, 400) && approxEqual(r!.y, 300),
    'resolveBedOriginMarker: front-right → canvas (bedWidth, bedHeight)');
}

// -------- 12. resolveBedOriginMarker — non-positive bedHeight falls back to default --------
{
  const r = resolveBedOriginMarker({
    originCorner: 'front-left',
    bedHeightMm: -10, // not positive
  });
  assert(r != null && approxEqual(r.y, DEFAULT_MACHINE_OVERLAY_BED_HEIGHT_MM),
    'resolveBedOriginMarker: non-positive bedHeight → DEFAULT_MACHINE_OVERLAY_BED_HEIGHT_MM');
}

// -------- 13. resolveMachineOriginMarker — absolute mode delegates to bed-origin --------
{
  const bounds = { minX: 5, minY: 6, maxX: 7, maxY: 8 };
  const r = resolveMachineOriginMarker(bounds, {
    startMode: 'absolute',
    originCorner: 'rear-left',
    bedHeightMm: 200,
  });
  assert(r != null && r.label === 'Bed origin',
    'resolveMachineOriginMarker: absolute → label "Bed origin"');
}

// -------- 14. resolveMachineOriginMarker — current mode uses scene bounds --------
{
  const bounds = { minX: 12, minY: 34, maxX: 56, maxY: 78 };
  const r = resolveMachineOriginMarker(bounds, { startMode: 'current' });
  assert(r != null && r.x === 12 && r.y === 34 && r.label === 'Head start',
    'resolveMachineOriginMarker: current → (minX, minY) with "Head start" label');
}

// -------- 15. resolveMachineOriginMarker — current mode requires non-degenerate bounds --------
{
  const r = resolveMachineOriginMarker(
    { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    { startMode: 'current' },
  );
  assert(r === null, 'resolveMachineOriginMarker: current with empty bounds → null');
}

// -------- 16. resolveMachineOriginMarker — savedOrigin mode --------
{
  const r = resolveMachineOriginMarker(
    { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    { startMode: 'savedOrigin', savedOrigin: { x: 42, y: 88 } },
  );
  assert(r != null && r.x === 42 && r.y === 88 && r.label === 'Saved zero',
    'resolveMachineOriginMarker: savedOrigin → marker at saved point with "Saved zero" label');
}

// -------- 17. resolveMachineOriginMarker — savedOrigin without point → null --------
{
  const r = resolveMachineOriginMarker(
    { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    { startMode: 'savedOrigin', savedOrigin: null },
  );
  assert(r === null, 'resolveMachineOriginMarker: savedOrigin null → null');
}

// -------- 18. resolveMachineOriginMarker — undefined start mode → null --------
{
  const r = resolveMachineOriginMarker(
    { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    {},
  );
  assert(r === null, 'resolveMachineOriginMarker: undefined startMode → null');
}

// -------- 19. Source-level pin: SceneRenderer delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const rendererSrc = readFileSync(
    resolve(here, '../src/ui/renderers/SceneRenderer.ts'),
    'utf-8',
  );
  assert(/from '\.\/sceneOverlayHelpers'/.test(rendererSrc),
    'SceneRenderer imports from ./sceneOverlayHelpers');
  for (const name of [
    'computeSceneBounds',
    'resolveMachineOriginMarker',
    'SceneBounds',
    'SceneMachineOverlayOptions',
    'MachineOriginMarker',
  ]) {
    assert(rendererSrc.includes(name),
      `SceneRenderer imports / uses ${name}`);
  }
  assert(/T1-132/.test(rendererSrc),
    'SceneRenderer carries T1-132 marker');
  // The pre-T1-132 inline definitions are gone.
  assert(!/^function computeSceneBounds/m.test(rendererSrc),
    'inline computeSceneBounds definition is gone from SceneRenderer');
  assert(!/^function hasSceneBounds/m.test(rendererSrc),
    'inline hasSceneBounds definition is gone from SceneRenderer');
  assert(!/^function positiveFinite/m.test(rendererSrc),
    'inline positiveFinite definition is gone from SceneRenderer');
  assert(!/^function resolveBedOriginMarker/m.test(rendererSrc),
    'inline resolveBedOriginMarker definition is gone from SceneRenderer');
  // Re-exports preserved.
  assert(/export \{ resolveMachineOriginMarker \} from '\.\/sceneOverlayHelpers'/.test(rendererSrc),
    'SceneRenderer re-exports resolveMachineOriginMarker from helper module');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/renderers/sceneOverlayHelpers.ts'),
    'utf-8',
  );
  assert(/T1-132/.test(helperSrc),
    'sceneOverlayHelpers carries T1-132 marker');
  for (const name of [
    'computeSceneBounds',
    'hasSceneBounds',
    'positiveFinite',
    'resolveBedOriginMarker',
    'resolveMachineOriginMarker',
  ]) {
    const re = new RegExp(`export function ${name}`);
    assert(re.test(helperSrc),
      `${name} is exported as module-scope function`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
