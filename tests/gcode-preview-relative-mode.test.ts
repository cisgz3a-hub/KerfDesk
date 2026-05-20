/**
 * F45-13-001: the G-code preview backplot must track G90/G91 distance
 * mode. Head/current-mode output uses G91, so X/Y words are deltas until
 * G90 restores absolute positioning.
 *
 * Run: npx tsx tests/gcode-preview-relative-mode.test.ts
 */
import assert from 'node:assert/strict';

import { analyzeEmittedBurnEnvelope } from '../src/core/output/emittedBurnEnvelope';
import { buildGcodePreviewModel } from '../src/ui/components/gcodePreviewModel';

const gcode = [
  'G21',
  'G91',
  'G0 X10 Y0',
  'M4 S500',
  'G1 X5 Y0 F1000',
  'G1 X0 Y5',
  'M5',
  'G1 X2 Y0',
  'G90',
  'G0 X1 Y1',
].join('\n');

console.log('\n=== F45-13-001 G-code preview relative mode ===\n');

const model = buildGcodePreviewModel(gcode);

assert.deepEqual(
  model.moves.map(move => ({
    from: [move.fromX, move.fromY],
    to: [move.toX, move.toY],
    type: move.type,
  })),
  [
    { from: [0, 0], to: [10, 0], type: 'rapid' },
    { from: [10, 0], to: [15, 0], type: 'cut' },
    { from: [15, 0], to: [15, 5], type: 'cut' },
    { from: [15, 5], to: [17, 5], type: 'travel' },
    { from: [17, 5], to: [1, 1], type: 'rapid' },
  ],
  'preview model accumulates G91 deltas and resumes absolute G90 targets',
);

assert.deepEqual(
  model.bounds,
  { minX: 0, minY: 0, maxX: 17, maxY: 5 },
  'preview bounds include the cumulative relative path',
);

const emitted = analyzeEmittedBurnEnvelope(gcode);
assert.deepEqual(
  emitted.burnBounds,
  { minX: 10, minY: 0, maxX: 15, maxY: 5 },
  'emitted analyzer control proves burn bounds for the same relative G-code',
);

const previewCutBounds = model.moves
  .filter(move => move.type === 'cut')
  .reduce(
    (bounds, move) => ({
      minX: Math.min(bounds.minX, move.fromX, move.toX),
      minY: Math.min(bounds.minY, move.fromY, move.toY),
      maxX: Math.max(bounds.maxX, move.fromX, move.toX),
      maxY: Math.max(bounds.maxY, move.fromY, move.toY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
assert.deepEqual(
  previewCutBounds,
  emitted.burnBounds,
  'preview cut bounds match emitted burn envelope for G91 output',
);

console.log('G-code preview relative mode: passed');
