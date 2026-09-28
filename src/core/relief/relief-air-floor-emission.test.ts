import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncContourPass, CncGroup, CncPass } from '../job';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import type { Vec2 } from '../scene';
import { keepProvenAirFloors } from './relief-air-floor-proof';

function pass(polyline: ReadonlyArray<Vec2>, zMm: number): CncContourPass {
  return { kind: 'contour', closed: false, polyline, zMm };
}

function emitAfterPlacement(
  passes: ReadonlyArray<CncPass>,
  mirror: number,
  offset: number,
): string {
  const placed = passes.map(
    (p): CncPass =>
      p.kind === 'contour'
        ? {
            ...p,
            polyline: p.polyline.map((point) => ({ x: offset + mirror * point.x, y: point.y })),
          }
        : p,
  );
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'relief-rough',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 5,
    retractBetweenPasses: true,
    passes: placed,
  };
  return cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
}

describe('relief floors survive final placement and output rounding', () => {
  it.each([
    [1, 0],
    [1, 10.0005],
    [-1, 10.0005],
  ])('declines a subdivided path after mirror %s and offset %s', (mirror, offset) => {
    const earlier = pass(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0.001 },
      ],
      -2,
    );
    const later = {
      ...pass(
        [
          { x: 5, y: 0.0005 },
          { x: 10, y: 0.001 },
        ],
        -4,
      ),
      airFloorZMm: -2,
    };
    const proven = keepProvenAirFloors([earlier, later], [-2, -2], 1.5875);
    expect(proven[1]).not.toHaveProperty('airFloorZMm');
    expect(emitAfterPlacement(proven, mirror, offset)).not.toContain('G0 Z-1.000');
  });

  it.each([
    [1, 0],
    [1, 10.0005],
    [-1, 10.0005],
  ])('retains an identical path after mirror %s and offset %s', (mirror, offset) => {
    const earlier = pass(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0.001 },
      ],
      -2,
    );
    const later = { ...earlier, zMm: -4, airFloorZMm: -2 };
    const proven = keepProvenAirFloors([earlier, later], [-2, -2], 1.5875);
    expect(proven[1]).toHaveProperty('airFloorZMm', -2);
    expect(emitAfterPlacement(proven, mirror, offset)).toContain('G0 Z-1.000');
  });

  it('keeps dense repeated paths without geometry-offset allocation or argument spreads', () => {
    const points = Array.from({ length: 150_000 }, (_, index) => ({ x: index * 0.01, y: 0 }));
    const earlier = pass(points, -2);
    const proven = keepProvenAirFloors(
      [earlier, { ...earlier, zMm: -4, airFloorZMm: -2 }],
      [-2, -2],
      1.5875,
    );
    expect(proven[1]).toHaveProperty('airFloorZMm', -2);
  });
});
