import { describe, expect, it } from 'vitest';
import { buildGrblFrameJogLines } from './grbl/frame-lines';
import { buildAbsoluteFrameLines } from './relative-jog-commands';

describe('chosen Frame start controller bytes', () => {
  it('starts and closes at the selected point on both controller protocols', () => {
    const bounds = {
      minX: 0,
      minY: 0,
      maxX: 20,
      maxY: 10,
      startPoint: { edge: 2 as const, fraction: 0.25 },
    };
    const coordinates = [
      'X15.000 Y10.000',
      'X0.000 Y10.000',
      'X0.000 Y0.000',
      'X20.000 Y0.000',
      'X20.000 Y10.000',
      'X15.000 Y10.000',
    ];
    expect(buildGrblFrameJogLines(bounds, 6000)).toEqual(
      coordinates.map((xy) => `$J=G90 G21 ${xy} F6000\n`),
    );
    expect(buildAbsoluteFrameLines(bounds, 6000)).toEqual([
      'G21\n',
      'G90\n',
      ...coordinates.map((xy) => `G0 ${xy} F6000\n`),
    ]);
  });
});
