import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject, type Transform, type Vec2 } from '../scene';
import { circleMatchesQuery, objectCircleDiameterMm } from './circle-detect';

describe('objectCircleDiameterMm', () => {
  it('reads a drawn circle from its placed size and rejects an oval', () => {
    expect(objectCircleDiameterMm(ellipse(10, 10, IDENTITY_TRANSFORM))).toBeCloseTo(10, 9);
    expect(
      objectCircleDiameterMm(ellipse(10, 5, { ...IDENTITY_TRANSFORM, scaleY: 2, rotationDeg: 33 })),
    ).toBeCloseTo(10, 9);
    expect(objectCircleDiameterMm(ellipse(10, 6, IDENTITY_TRANSFORM))).toBeNull();
  });

  it('reads an imported sampled circle in world size', () => {
    const svg = imported([ring(64, 2.5)], { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2 });
    expect(objectCircleDiameterMm(svg)).toBeCloseTo(10, 6);
  });

  it('rejects polygons, ovals, open paths and artwork holding more than one shape', () => {
    expect(objectCircleDiameterMm(imported([ring(12, 5)]))).toBeNull();
    expect(objectCircleDiameterMm(imported([ring(64, 5, 0.8)]))).toBeNull();
    expect(
      objectCircleDiameterMm(imported([{ points: ring(64, 5).points, closed: false }])),
    ).toBeNull();
    expect(objectCircleDiameterMm(imported([ring(64, 5), ring(64, 2)]))).toBeNull();
  });
});

describe('circleMatchesQuery', () => {
  it('matches an exact size within tolerance and an inclusive range', () => {
    expect(circleMatchesQuery(3.005, { kind: 'exact', diameterMm: 3, toleranceMm: 0.01 })).toBe(
      true,
    );
    expect(circleMatchesQuery(3.02, { kind: 'exact', diameterMm: 3, toleranceMm: 0.01 })).toBe(
      false,
    );
    expect(circleMatchesQuery(5, { kind: 'range', minMm: 2, maxMm: 5 })).toBe(true);
    expect(circleMatchesQuery(5.1, { kind: 'range', minMm: 2, maxMm: 5 })).toBe(false);
  });
});

function ring(count: number, radius: number, squash = 1): { points: Vec2[]; closed: boolean } {
  const points = Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return { x: 20 + radius * Math.cos(angle), y: 20 + radius * squash * Math.sin(angle) };
  });
  return { points, closed: true };
}

function imported(
  polylines: ReadonlyArray<{ points: Vec2[]; closed: boolean }>,
  transform: Transform = IDENTITY_TRANSFORM,
): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'svg',
    source: 'test.svg',
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    transform,
    paths: [{ color: '#000000', polylines }],
  };
}

function ellipse(width: number, height: number, transform: Transform): SceneObject {
  return {
    kind: 'shape',
    id: 'ellipse',
    spec: { kind: 'ellipse', widthMm: width, heightMm: height },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    transform,
    paths: [],
  };
}
