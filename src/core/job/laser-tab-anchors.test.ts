import { describe, expect, it } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type SceneObject,
} from '../scene';
import {
  automaticLaserTabHints,
  placedLaserTabCount,
  placedTabPointsForKerfContours,
  projectLaserTabAnchor,
} from './laser-tab-anchors';

const RED = '#ff0000';

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

function object(
  id: string,
  polylines: ReadonlyArray<Polyline>,
  extra: Partial<ImportedSvg> = {},
): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: RED, polylines }],
    ...extra,
  };
}

const TABS = { ...createLayer({ id: 'L1', color: RED }), tabsEnabled: true, tabsPerShape: 2 };

describe('laser tab anchors (ADR-494)', () => {
  it('projects a point onto the nearest closed contour of the colour', () => {
    const part = object('part', [square(0, 0, 10)]);
    expect(projectLaserTabAnchor(part, RED, { x: 10.5, y: 5 })).toEqual({
      anchor: { layerColor: RED, pathIndex: 0, polylineIndex: 0, pathT: 0.375 },
      distanceMm: 0.5,
    });
    expect(projectLaserTabAnchor(part, '#0000ff', { x: 10, y: 5 })).toBeNull();
  });

  it('hints the automatic tabs only on contours without placed tabs', () => {
    const polylines = [square(0, 0, 10), square(20, 0, 10)];
    expect(automaticLaserTabHints(object('part', polylines), RED, TABS)).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: 30, y: 0 },
      { x: 20, y: 10 },
    ]);
    const placed = object('part', polylines, {
      laserTabAnchors: [{ layerColor: RED, pathIndex: 0, polylineIndex: 1, pathT: 0.5 }],
    });
    expect(automaticLaserTabHints(placed, RED, TABS)).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]);
    expect(automaticLaserTabHints(placed, RED, { ...TABS, tabsEnabled: false })).toEqual([]);
  });

  it('counts the tabs placed on the paths an operation cuts', () => {
    const anchor = { layerColor: RED, pathIndex: 0, polylineIndex: 0, pathT: 0.5 };
    const objects = [
      object('a', [square(0, 0, 10)], { laserTabAnchors: [anchor, { ...anchor, pathT: 0.1 }] }),
      object('b', [square(0, 0, 10)], { laserTabAnchors: [{ ...anchor, layerColor: '#00ff00' }] }),
      object('c', [square(0, 0, 10)]),
    ];
    expect(placedLaserTabCount(objects, createLayer({ id: 'L1', color: RED }))).toBe(2);
    expect(placedLaserTabCount(objects, createLayer({ id: 'L2', color: '#0000ff' }))).toBe(0);
  });

  it('gives each kerf contour the tabs of the source contour it came from', () => {
    const outer = square(0, 0, 10);
    const hole = square(3, 3, 4);
    const grownOuter = square(-0.5, -0.5, 11);
    const shrunkHole = square(3.5, 3.5, 3);
    const mapped = placedTabPointsForKerfContours(
      [shrunkHole, grownOuter],
      [
        { polyline: outer, points: [{ x: 5, y: 0 }] },
        { polyline: hole, points: [{ x: 3, y: 5 }] },
      ],
    );
    expect(mapped).toEqual([[{ x: 3, y: 5 }], [{ x: 5, y: 0 }]]);
    expect(placedTabPointsForKerfContours([grownOuter], [{ polyline: outer, points: [] }])).toEqual(
      [[]],
    );
  });
});
