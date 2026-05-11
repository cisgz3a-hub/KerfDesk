import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { transformPointToMachine, type MachineTransformOptions } from '../src/core/plan/MachineTransform';
import { resolveMachineOriginMarker } from '../src/ui/renderers/SceneRenderer';

const designBounds = { minX: 24, minY: 36, maxX: 120, maxY: 90 };
const emptyBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

assert.deepEqual(
  resolveMachineOriginMarker(designBounds, {
    startMode: 'savedOrigin',
    savedOrigin: null,
    bedWidthMm: 400,
    bedHeightMm: 300,
  }),
  null,
  'saved-origin mode without a saved origin draws no green canvas marker',
);

function assertMarkerMapsToMachineZero(opts: MachineTransformOptions): void {
  const marker = resolveMachineOriginMarker(designBounds, opts);
  assert.ok(marker, `${opts.originCorner} absolute mode resolves a marker`);
  assert.equal(marker.label, 'Bed origin', `${opts.originCorner} marker label`);
  const machine = transformPointToMachine(marker, designBounds, opts);
  assert.ok(Math.abs(machine.x) < 0.001, `${opts.originCorner} marker maps to machine X0 (got ${machine.x})`);
  assert.ok(Math.abs(machine.y) < 0.001, `${opts.originCorner} marker maps to machine Y0 (got ${machine.y})`);
}

assert.deepEqual(
  resolveMachineOriginMarker(designBounds, {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'rear-left',
    bedWidthMm: 400,
    bedHeightMm: 300,
  }),
  { x: 0, y: 0, label: 'Bed origin' },
  'absolute rear-left marks the top-left bed origin',
);

assert.deepEqual(
  resolveMachineOriginMarker(designBounds, {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'front-left',
    bedWidthMm: 400,
    bedHeightMm: 300,
  }),
  { x: 0, y: 300, label: 'Bed origin' },
  'absolute front-left marks the bottom-left bed origin',
);

assertMarkerMapsToMachineZero({
  startMode: 'absolute',
  savedOrigin: null,
  originCorner: 'front-left',
  bedWidthMm: 400,
  bedHeightMm: 300,
});

assertMarkerMapsToMachineZero({
  startMode: 'absolute',
  savedOrigin: null,
  originCorner: 'front-right',
  bedWidthMm: 400,
  bedHeightMm: 300,
});

assertMarkerMapsToMachineZero({
  startMode: 'absolute',
  savedOrigin: null,
  originCorner: 'rear-right',
  bedWidthMm: 400,
  bedHeightMm: 300,
});

assert.deepEqual(
  resolveMachineOriginMarker(designBounds, {
    startMode: 'current',
    bedWidthMm: 400,
    bedHeightMm: 300,
  }),
  { x: 24, y: 36, label: 'Head start' },
  'current mode marks the local design start corner',
);

assert.deepEqual(
  resolveMachineOriginMarker(emptyBounds, {
    startMode: 'current',
    bedWidthMm: 400,
    bedHeightMm: 300,
  }),
  null,
  'current mode does not mark an empty scene',
);

assert.deepEqual(
  resolveMachineOriginMarker(designBounds, {
    startMode: 'savedOrigin',
    savedOrigin: { x: 42, y: 18 },
    bedWidthMm: 400,
    bedHeightMm: 300,
  }),
  { x: 42, y: 18, label: 'Saved zero' },
  'saved-origin mode marks the saved zero coordinate',
);

const source = readFileSync('src/ui/renderers/SceneRenderer.ts', 'utf8');
const overlayStart = source.indexOf('function renderMachineOriginOverlay');
const backgroundStart = source.indexOf('export function renderSceneBackground');
assert.ok(overlayStart >= 0, 'renderMachineOriginOverlay exists');
assert.ok(backgroundStart > overlayStart, 'renderSceneBackground follows renderMachineOriginOverlay');
const overlayBody = source.slice(overlayStart, backgroundStart);

assert.ok(overlayBody.includes('resolveMachineOriginMarker'), 'overlay rendering uses the marker resolver');
// T1-132: the marker-resolution geometry helpers (computeSceneBounds /
// resolveMachineOriginMarker / etc.) moved to ./sceneOverlayHelpers,
// so the `transformPointToMachine` import moved with them. The pin
// now scans the helper module — the property we want preserved is
// "the same transform helper used for frame and G-code math drives
// the overlay marker placement", which holds via the helper module.
const helperSource = readFileSync('src/ui/renderers/sceneOverlayHelpers.ts', 'utf8');
assert.ok(
  helperSource.includes('transformPointToMachine'),
  'sceneOverlayHelpers imports the same transformPointToMachine helper used for frame and G-code math',
);
assert.ok(
  !/strokeRect\s*\(/.test(overlayBody),
  'job-position overlay no longer draws a large reachable-area rectangle',
);

console.log('machine origin overlay marker assertions passed');
