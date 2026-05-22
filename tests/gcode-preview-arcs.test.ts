/**
 * LF-EXT-LGRBL-003: G-code preview must preserve parser-state arc geometry.
 *
 * External sender comparators render preview from parsed controller commands,
 * not from endpoint-only chords. A powered semicircle burns through the arc
 * apex even though its endpoints sit on a straight line.
 *
 * Run: npx tsx tests/gcode-preview-arcs.test.ts
 */
import assert from 'node:assert/strict';

import { analyzeEmittedBurnEnvelope } from '../src/core/output/emittedBurnEnvelope';
import { buildGcodePreviewModel } from '../src/ui/components/gcodePreviewModel';

function cutBounds(model: ReturnType<typeof buildGcodePreviewModel>) {
  return model.moves
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
}

console.log('\n=== LF-EXT-LGRBL-003 G-code preview arc parity ===\n');

const gcode = [
  'G21',
  'G90',
  'G0 X10 Y0',
  'M4 S500',
  'G3 X-10 Y0 I-10 J0 F1000',
  'M5',
].join('\n');

const model = buildGcodePreviewModel(gcode);
const emitted = analyzeEmittedBurnEnvelope(gcode);
const previewCutBounds = cutBounds(model);

assert(model.cutCount > 1, 'preview splits the powered arc into visible cut segments');
assert(previewCutBounds.minX <= -9.999, `preview arc reaches left endpoint (got ${previewCutBounds.minX})`);
assert(previewCutBounds.maxX >= 9.999, `preview arc reaches right endpoint (got ${previewCutBounds.maxX})`);
assert(previewCutBounds.maxY >= 9.9, `preview arc includes the top of the semicircle (got ${previewCutBounds.maxY})`);
assert.deepEqual(
  emitted.burnBounds,
  { minX: -10, minY: 0, maxX: 10, maxY: 10 },
  'emitted burn-envelope control proves the real arc burn bounds',
);
assert(
  Math.abs(previewCutBounds.maxY - emitted.burnBounds!.maxY) < 0.1,
  'preview cut bounds match emitted arc burn envelope closely enough for operator preview',
);

console.log('G-code preview arc parity: passed');
