/**
 * LF-EXT-UGS-004: preview/output parity fixtures.
 *
 * UGS keeps parser fixtures that compare stream output with parsed/visualized
 * behavior. LaserForge's G-code preview and emitted-output burn envelope use
 * separate parsers, so high-risk modal cases need paired fixtures proving the
 * operator preview agrees with the emitted program.
 *
 * Run: npx tsx tests/gcode-preview-output-parity-fixtures.test.ts
 */
import assert from 'node:assert/strict';

import { analyzeEmittedBurnEnvelope, type EmittedBurnEnvelope } from '../src/core/output/emittedBurnEnvelope';
import {
  buildGcodePreviewModel,
  type GcodePreviewBounds,
  type GcodePreviewMove,
} from '../src/ui/components/gcodePreviewModel';

interface Fixture {
  readonly name: string;
  readonly gcode: string;
  readonly toleranceMm?: number;
}

function previewCutBounds(moves: readonly GcodePreviewMove[]): GcodePreviewBounds | null {
  let out: GcodePreviewBounds | null = null;
  for (const move of moves) {
    if (move.type !== 'cut') continue;
    out = out === null
      ? {
          minX: Math.min(move.fromX, move.toX),
          minY: Math.min(move.fromY, move.toY),
          maxX: Math.max(move.fromX, move.toX),
          maxY: Math.max(move.fromY, move.toY),
        }
      : {
          minX: Math.min(out.minX, move.fromX, move.toX),
          minY: Math.min(out.minY, move.fromY, move.toY),
          maxX: Math.max(out.maxX, move.fromX, move.toX),
          maxY: Math.max(out.maxY, move.fromY, move.toY),
        };
  }
  return out;
}

function assertBoundsClose(
  name: string,
  preview: GcodePreviewBounds | null,
  emitted: EmittedBurnEnvelope['burnBounds'],
  toleranceMm = 0.001,
): void {
  assert(preview !== null, `${name}: preview has cut bounds`);
  assert(emitted !== null, `${name}: emitted output has burn bounds`);
  for (const edge of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    const delta = Math.abs(preview[edge] - emitted[edge]);
    assert(
      delta <= toleranceMm,
      `${name}: ${edge} preview=${preview[edge]} emitted=${emitted[edge]} delta=${delta}`,
    );
  }
}

const fixtures: readonly Fixture[] = [
  {
    name: 'same-block relative mode after motion word',
    gcode: [
      'G21',
      'G90',
      'G0 X100 Y0',
      'M4 S500',
      'G1 X10 Y0 G91',
      'M5 S0',
    ].join('\n'),
  },
  {
    name: 'embedded laser modal and S-value words',
    gcode: [
      'G21',
      'G90',
      'G0 X0 Y0',
      'G1 X10 Y0 M4 S600',
      'G1 X20 Y0 S0',
      'G1 X30 Y0 M4 S500',
      'G1 X40 Y0 M5',
      'M2',
    ].join('\n'),
  },
  {
    name: 'comments and whitespace do not create fake burns',
    gcode: [
      'G21 ; units',
      'G90',
      'G0 X5 Y5 (M4 S1000 documentation only)',
      'M4 S700',
      '  G1   X25   Y5   F900   ; real burn',
      '; M5 in a standalone comment',
      'G1 X35 Y5 S0 (laser-off travel)',
      'M5 S0',
    ].join('\n'),
  },
  {
    name: 'arc preview follows emitted arc envelope',
    toleranceMm: 0.1,
    gcode: [
      'G21',
      'G90',
      'G0 X10 Y0',
      'M4 S500',
      'G3 X-10 Y0 I-10 J0 F1000',
      'M5 S0',
    ].join('\n'),
  },
];

console.log('\n=== LF-EXT-UGS-004 preview/output parity fixtures ===\n');

for (const fixture of fixtures) {
  const model = buildGcodePreviewModel(fixture.gcode);
  const emitted = analyzeEmittedBurnEnvelope(fixture.gcode);
  assertBoundsClose(
    fixture.name,
    previewCutBounds(model.moves),
    emitted.burnBounds,
    fixture.toleranceMm,
  );
  assert(model.cutCount > 0, `${fixture.name}: preview records cut motion`);
  assert(emitted.burnMoveCount > 0, `${fixture.name}: emitted parser records burn motion`);
  console.log(`  ok ${fixture.name}`);
}

console.log('\nPreview/output parity fixtures: passed\n');
