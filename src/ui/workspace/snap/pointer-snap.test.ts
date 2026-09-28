import { describe, expect, it } from 'vitest';
import { DEFAULT_SNAP_SETTINGS, type SnapSettings } from '../snap-settings';
import { resolvePointerSnap, snapReachMm } from './pointer-snap';
import { projectWith, square } from './snap-scene.test-support';

// 8 px default reach at 0.25 mm per pixel: 2 mm.
const PX_TO_MM = 0.25;

describe('snapReachMm', () => {
  it('converts the pixel distance through the zoom', () => {
    expect(snapReachMm(DEFAULT_SNAP_SETTINGS, PX_TO_MM)).toBe(2);
    expect(snapReachMm({ ...DEFAULT_SNAP_SETTINGS, distancePx: 20 }, 0.1)).toBeCloseTo(2);
    expect(snapReachMm(DEFAULT_SNAP_SETTINGS, Number.NaN)).toBe(0);
  });
});

describe('resolvePointerSnap', () => {
  const project = projectWith([square('sq', 100, 100)]);
  const resolve = (
    x: number,
    y: number,
    settings: Partial<SnapSettings> = {},
    suppressed = false,
  ) =>
    resolvePointerSnap({
      project,
      rawMm: { x, y },
      pxToMm: PX_TO_MM,
      settings: { ...DEFAULT_SNAP_SETTINGS, ...settings },
      suppressed,
    });

  it('lands on a point target with its marker', () => {
    expect(resolve(101, 99)).toEqual({
      pointMm: { x: 100, y: 100 },
      marker: { kind: 'node', pointMm: { x: 100, y: 100 } },
      guides: [],
    });
  });

  it('prefers a point on artwork to the grid', () => {
    // (99, 101) is 1 mm from the grid crossing (100, 100) too, but the node wins.
    const result = resolve(100.5, 101);

    expect(result.marker?.kind).toBe('node');
  });

  it('is magnetic to grid lines per axis, with a guide for each snapped axis', () => {
    const both = resolve(21.5, 38.4);
    expect(both.pointMm).toEqual({ x: 20, y: 40 });
    expect(both.marker).toEqual({ kind: 'grid', pointMm: { x: 20, y: 40 } });
    expect(both.guides.map((guide) => guide.axis).sort()).toEqual(['x', 'y']);

    const oneAxis = resolve(21.5, 35);
    expect(oneAxis.pointMm).toEqual({ x: 20, y: 35 });
    expect(oneAxis.marker).toBeNull();
    expect(oneAxis.guides).toEqual([
      { axis: 'x', positionMm: 20, fromMm: 0, toMm: project.device.bedHeight },
    ]);
  });

  it('uses the grid spacing setting', () => {
    expect(resolve(26.2, 35, { gridMm: 25 }).pointMm).toEqual({ x: 25, y: 35 });
  });

  it('leaves the point alone when snapping is off, suppressed, or out of reach', () => {
    const raw = { pointMm: { x: 101, y: 99 }, marker: null, guides: [] };

    expect(resolve(101, 99, { enabled: false })).toEqual(raw);
    expect(resolve(101, 99, {}, true)).toEqual(raw);
    expect(resolve(45, 45).pointMm).toEqual({ x: 45, y: 45 });
    expect(resolve(21.5, 38.4, { snapToGrid: false }).pointMm).toEqual({ x: 21.5, y: 38.4 });
  });

  it('falls back to the grid when every point kind is switched off', () => {
    const result = resolve(101, 99, {
      snapToNodes: false,
      snapToMidpoints: false,
      snapToCenters: false,
      snapToIntersections: false,
    });

    expect(result.marker).toEqual({ kind: 'grid', pointMm: { x: 100, y: 100 } });
  });
});
