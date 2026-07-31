import { describe, expect, it } from 'vitest';
import { importWorkerTransferables } from './import-worker-transferables';
import { packGcodeResult, packedGcodeTransferables } from './packed-gcode-result';

describe('importWorkerTransferables', () => {
  it('transfers ownership of a prepared STL mesh', () => {
    const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 1]);
    const response = {
      id: 1,
      kind: 'stl' as const,
      result: {
        kind: 'ok' as const,
        positions,
        widthMm: 100,
        heightMm: 100,
        format: 'binary' as const,
      },
    };

    expect(importWorkerTransferables(response)).toEqual([positions.buffer]);
  });

  it('transfers packed 2D G-code geometry instead of cloning its object graph', () => {
    const result = packGcodeResult({
      kind: 'ok',
      toolpath: {
        totalLength: 1,
        steps: [
          {
            kind: 'cut',
            color: '#123456',
            polyline: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
            length: 1,
          },
        ],
      },
      summary: { lineCount: 1, cutMm: 1, travelMm: 0, plungeMm: 0 },
      notes: [],
    });

    expect(importWorkerTransferables({ id: 1, kind: 'gcode', result })).toEqual(
      packedGcodeTransferables(result),
    );
  });
});
