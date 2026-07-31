import { describe, expect, it } from 'vitest';
import type { ParseDxfResult } from '../../io/dxf';
import { packDxfResult, packedDxfTransferables, unpackDxfResult } from './packed-dxf-result';

const RESULT: ParseDxfResult = {
  kind: 'ok',
  object: {
    kind: 'imported-svg',
    id: 'dxf-object',
    source: 'fixture.dxf',
    bounds: { minX: 0, minY: 0, maxX: 12, maxY: 8 },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      mirrorX: false,
      mirrorY: false,
    },
    paths: [
      {
        color: '#123456',
        polylines: [
          {
            closed: true,
            points: [
              { x: 1, y: 2 },
              { x: 3, y: 4 },
              { x: 1, y: 2 },
            ],
          },
        ],
        curves: [
          {
            start: { x: 1, y: 2 },
            closed: true,
            segments: [
              { kind: 'line', to: { x: 3, y: 4 } },
              {
                kind: 'cubic',
                control1: { x: 5, y: 6 },
                control2: { x: 7, y: 8 },
                to: { x: 9, y: 10 },
              },
              {
                kind: 'elliptical-arc',
                radiusX: 11,
                radiusY: 12,
                rotationDeg: 30,
                largeArc: true,
                sweep: false,
                to: { x: 1, y: 2 },
              },
            ],
          },
        ],
      },
    ],
  },
  pathCount: 1,
  notes: ['fixture note'],
  skippedSummary: '1 TEXT',
};

describe('packed DXF worker result', () => {
  it('round-trips every DXF geometry field exactly', () => {
    expect(unpackDxfResult(packDxfResult(RESULT))).toEqual(RESULT);
  });

  it('transfers every packed geometry buffer and preserves non-geometry results', () => {
    const packed = packDxfResult(RESULT);
    expect(packedDxfTransferables(packed).length).toBeGreaterThan(5);
    expect(new Set(packedDxfTransferables(packed)).size).toBe(
      packedDxfTransferables(packed).length,
    );

    const error: ParseDxfResult = { kind: 'error', reason: 'bad DXF' };
    expect(unpackDxfResult(packDxfResult(error))).toEqual(error);
    expect(packedDxfTransferables(packDxfResult(error))).toEqual([]);
  });
});
