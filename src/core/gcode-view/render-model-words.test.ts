import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel } from './gcode-render-model';
import {
  LINE_CATEGORY,
  SEG_KIND,
  SEG_MOTION,
  type BuildRenderModelOptions,
  type GcodeRenderModel,
} from './render-model-types';

function model(lines: ReadonlyArray<string>, options: BuildRenderModelOptions = {}) {
  const result = buildGcodeRenderModel(lines.join('\n'), options);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

function segmentEnd(render: GcodeRenderModel, index: number): ReadonlyArray<number> {
  return Array.from(render.positions.subarray(index * 6 + 3, index * 6 + 6));
}

// GRBL treats M2/M30 as a program end, not a stop (gcode.c, "[21. Program
// flow ]"), and the streamer sends every line, so later lines run.
describe('render model after M2/M30', () => {
  it('draws the moves after a program end', () => {
    // Two programs joined in one file, as a pocket followed by a profile.
    const lines = ['G21 G90', 'M3 S1000', 'G1 X10 F100', 'M5', 'M30'];
    const joined = model([...lines, 'G0 X200 Y150', 'M3 S1000', 'G1 X300 F100', 'M5', 'M30']);
    expect(joined.segmentCount).toBe(3);
    expect(joined.stats.motionBounds).toMatchObject({ maxX: 300, maxY: 150 });
    expect(joined.lineCategories[5]).toBe(LINE_CATEGORY.motion);
    expect(joined.lineCategories[7]).toBe(LINE_CATEGORY.motion);
  });

  it("resets G1, G90 and the spindle once the ending line's own move has run", () => {
    const render = model(['G21 G91', 'M3 S500', 'G0 X5 M30', 'X20'], {
      machineKind: 'laser',
      laserPowerControl: 'spindle',
    });
    // The M30 line still moves as G0 and G91 said: 0 to 5.
    expect(render.segMotion[0]).toBe(SEG_MOTION.rapid);
    expect(segmentEnd(render, 0)).toEqual([5, 0, 0]);
    // After it, X20 is an absolute G1 with the laser off until a new M3/M4.
    expect(render.segMotion[1]).toBe(SEG_MOTION.linear);
    expect(segmentEnd(render, 1)).toEqual([20, 0, 0]);
    expect(render.segKind[1]).toBe(SEG_KIND.travel);
  });
});

describe('render model units', () => {
  // GRBL converts F with the block's own units, whatever the word order
  // (gcode.c: gc_block.modal.units).
  it.each([
    ['F before G20', ['G21', 'F10 G20 G1 X1'], 254],
    ['F after G20', ['G21', 'G20 F10 G1 X1'], 254],
    ['F before G21', ['G20', 'F100 G21 G1 X1'], 100],
  ])('converts %s with the line’s own units', (_, lines, feedMmPerMin) => {
    expect(model(lines).segFeed[0]).toBeCloseTo(feedMmPerMin, 6);
  });
});
