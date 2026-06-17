import { describe, expect, it } from 'vitest';

import type { Polyline } from '../scene';
import { applyFillScanCalibration } from './fill-scan-calibration';

describe('applyFillScanCalibration', () => {
  it('shifts scanline segments ahead in their travel direction plus initial X', () => {
    const polylines: ReadonlyArray<Polyline> = [
      {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
        ],
      },
      {
        closed: false,
        points: [
          { x: 4, y: 1 },
          { x: 0, y: 1 },
        ],
      },
    ];

    const shifted = applyFillScanCalibration(polylines, {
      initialXOffsetMm: 0.1,
      bidirectionalOffsetMm: 0.25,
    });

    expect(shifted[0]?.points).toEqual([
      { x: 0.35, y: 0 },
      { x: 4.35, y: 0 },
    ]);
    expect(shifted[1]?.points).toEqual([
      { x: 3.85, y: 1 },
      { x: -0.15, y: 1 },
    ]);
  });

  it('applies travel-direction compensation to angled and vertical scans', () => {
    const shifted = applyFillScanCalibration(
      [
        {
          closed: false,
          points: [
            { x: 2, y: 2 },
            { x: 2, y: 6 },
          ],
        },
      ],
      { initialXOffsetMm: 0.1, bidirectionalOffsetMm: 0.25 },
    );

    expect(shifted[0]?.points[0]?.x).toBeCloseTo(2.1);
    expect(shifted[0]?.points[0]?.y).toBeCloseTo(2.25);
    expect(shifted[0]?.points[1]?.x).toBeCloseTo(2.1);
    expect(shifted[0]?.points[1]?.y).toBeCloseTo(6.25);
  });
});
