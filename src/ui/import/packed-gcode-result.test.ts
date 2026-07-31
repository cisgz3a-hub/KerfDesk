import { describe, expect, it } from 'vitest';
import type { ParseGcodeProgramResult } from '../../io/gcode';
import {
  packGcodeResult,
  packedGcodeTransferables,
  unpackGcodeResult,
} from './packed-gcode-result';

const RESULT: ParseGcodeProgramResult = {
  kind: 'ok',
  toolpath: {
    totalLength: 30,
    steps: [
      {
        kind: 'travel',
        from: { x: 1, y: 2 },
        to: { x: 3, y: 4 },
        length: 5,
        motion: 'feed',
        z: { from: 6, to: 7 },
      },
      {
        kind: 'cut',
        color: '#abcdef',
        polyline: [
          { x: 3, y: 4 },
          { x: 8, y: 9 },
          { x: 10, y: 11 },
        ],
        length: 20,
        z: { from: 7, to: 5 },
        groupId: 'group-a',
        passIndex: 2,
        source: {
          kind: 'raster',
          objectId: 'image-a',
          source: 'source.png',
          passIndex: 2,
          rowIndex: 3,
          spanIndex: 4,
          pixelStartX: 5,
          pixelEndX: 6,
        },
      },
      {
        kind: 'plunge',
        at: { x: 10, y: 11 },
        fromZ: 5,
        toZ: 0,
        length: 5,
      },
    ],
  },
  summary: { lineCount: 12, cutMm: 20, travelMm: 5, plungeMm: 5 },
  notes: ['1× unsupported G43'],
};

describe('packed 2D G-code worker result', () => {
  it('round-trips every ToolpathStep field exactly', () => {
    expect(unpackGcodeResult(packGcodeResult(RESULT))).toEqual(RESULT);
  });

  it('transfers every packed geometry buffer and preserves errors', () => {
    const packed = packGcodeResult(RESULT);
    expect(packedGcodeTransferables(packed).length).toBeGreaterThan(4);
    expect(new Set(packedGcodeTransferables(packed)).size).toBe(
      packedGcodeTransferables(packed).length,
    );

    const error: ParseGcodeProgramResult = { kind: 'error', reason: 'bad G-code' };
    expect(unpackGcodeResult(packGcodeResult(error))).toEqual(error);
    expect(packedGcodeTransferables(packGcodeResult(error))).toEqual([]);
  });
});
