import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

assert.deepEqual(
  resolveMachineOriginMarker(designBounds, {
    startMode: 'absolute',
    bedWidthMm: 400,
    bedHeightMm: 300,
  }),
  { x: 0, y: 0, label: 'Bed origin' },
  'absolute mode marks only the bed origin',
);

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
assert.ok(
  !/strokeRect\s*\(/.test(overlayBody),
  'job-position overlay no longer draws a large reachable-area rectangle',
);

console.log('machine origin overlay marker assertions passed');
