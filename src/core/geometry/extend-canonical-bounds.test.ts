import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { createExtendModel, extendEdit, findExtendTarget } from './extend-shapes';
import { MAX_FLATTENED_CURVE_SEGMENTS } from '../scene/curve-path';

const p = (x: number, y: number) => ({ x, y });
const curve: CurveSubpath = {
  start: p(100, 20),
  closed: false,
  segments: [{ kind: 'cubic', control1: p(110, 20), control2: p(120, 20), to: p(130, 20) }],
};

function artwork(id: string, canonical?: CurveSubpath): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [
      {
        color: '#000000',
        polylines: [{ closed: false, points: [p(0, 0), p(1, 0)] }],
        ...(canonical === undefined ? {} : { curves: [canonical] }),
      },
    ],
  };
}

function scene(...objects: ImportedSvg[]): Scene {
  return { objects, groups: [], layers: [createLayer({ id: 'cut', color: '#000000' })] };
}

describe('Extend canonical endpoint bounds', () => {
  it.each(['start', 'end'] as const)(
    'rebuilds stale compatibility geometry after extending a cubic %s',
    (end) => {
      const canonical: CurveSubpath = {
        start: p(100, 0),
        closed: false,
        segments: [{ kind: 'cubic', control1: p(103, 6), control2: p(107, 0), to: p(110, 0) }],
      };
      const source = artwork('source', canonical);
      const x = end === 'start' ? 90 : 120;
      const boundary = artwork('boundary', {
        start: p(x, -30),
        closed: false,
        segments: [{ kind: 'line', to: p(x, 30) }],
      });
      const at = end === 'start' ? canonical.start : p(110, 0);
      const target = findExtendTarget(scene(source, boundary), at, 0.1);
      expect(target?.status).toBe('ready');
      const paths = extendEdit(source, target!);
      expect(paths).not.toBeNull();
      const path = paths![0]!;
      const edited = path.curves![0]!;
      expect(edited.segments[end === 'start' ? 1 : 0]).toEqual(canonical.segments[0]);
      const expected = flattenCurveSubpath(edited, { toleranceMm: 0.025 });
      if (expected.kind !== 'ok') throw new Error('Expected fixture to flatten');
      expect(path.polylines[0]).toEqual(expected.polyline);
      expect(path.polylines[0]!.points).toContainEqual(at);
      expect(path.polylines[0]!.points).not.toContainEqual(p(1, 0));
      expect(source.paths[0]!.polylines[0]!.points).toEqual([p(0, 0), p(1, 0)]);
    },
  );

  it.each(['start', 'end'] as const)(
    'rebuilds a stale line cache while moving only its canonical %s',
    (end) => {
      const canonical: CurveSubpath = {
        start: p(100, 0),
        closed: false,
        segments: [{ kind: 'line', to: p(110, 0) }],
      };
      const source = artwork('source', canonical);
      const x = end === 'start' ? 90 : 120;
      const boundary = artwork('boundary', {
        start: p(x, -10),
        closed: false,
        segments: [{ kind: 'line', to: p(x, 10) }],
      });
      const target = findExtendTarget(
        scene(source, boundary),
        p(end === 'start' ? 100 : 110, 0),
        0.1,
      );
      const edited = extendEdit(source, target!)?.[0];
      const points = end === 'start' ? [p(90, 0), p(110, 0)] : [p(100, 0), p(120, 0)];
      expect(edited?.polylines[0]?.points).toEqual(points);
      expect(edited?.curves?.[0]).toEqual({
        start: points[0],
        closed: false,
        segments: [{ kind: 'line', to: points[1] }],
      });
    },
  );

  it('rejects the entire edit when canonical rebuilding exceeds the flattening budget', () => {
    const canonical: CurveSubpath = {
      start: p(100, 0),
      closed: false,
      segments: [
        ...Array.from({ length: MAX_FLATTENED_CURVE_SEGMENTS }, () => ({
          kind: 'line' as const,
          to: p(100, 0),
        })),
        { kind: 'cubic', control1: p(103, 6), control2: p(107, 0), to: p(110, 0) },
      ],
    };
    const source = artwork('source', canonical);
    const boundary = artwork('boundary', {
      start: p(120, -10),
      closed: false,
      segments: [{ kind: 'line', to: p(120, 10) }],
    });
    const target = findExtendTarget(scene(source, boundary), p(110, 0), 0.1);
    expect(target?.status).toBe('ready');
    expect(extendEdit(source, target!)).toBeNull();
    expect(source.paths[0]?.curves?.[0]).toBe(canonical);
    expect(canonical.segments).toHaveLength(MAX_FLATTENED_CURVE_SEGMENTS + 1);
    expect(source.paths[0]?.polylines[0]?.points).toEqual([p(0, 0), p(1, 0)]);
  });

  it('picks both canonical endpoints outside stale object and compatibility bounds', () => {
    const source = artwork('source', curve);
    const left = artwork('left', {
      start: p(90, 10),
      closed: false,
      segments: [{ kind: 'line', to: p(90, 30) }],
    });
    const right = artwork('right', {
      start: p(140, 10),
      closed: false,
      segments: [{ kind: 'line', to: p(140, 30) }],
    });
    const model = createExtendModel(scene(source, left, right));
    expect(findExtendTarget(model, curve.start, 0.1)).toMatchObject({
      status: 'ready',
      end: 'start',
      from: curve.start,
      to: p(90, 20),
    });
    expect(findExtendTarget(model, p(130, 20), 0.1)).toMatchObject({
      status: 'ready',
      end: 'end',
      to: p(140, 20),
    });
    expect(findExtendTarget(model, p(1, 0), 0.1)).toBeNull();
  });

  it('transforms canonical bounds through scale, reflection and rotation', () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      scaleX: 2,
      scaleY: 3,
      rotationDeg: 37,
      mirrorX: true,
      x: 12,
      y: -8,
    };
    const source = { ...artwork('source', curve), transform };
    const target = {
      ...artwork('target', {
        start: p(140, 10),
        closed: false,
        segments: [{ kind: 'line', to: p(140, 30) }],
      }),
      transform,
    };
    const found = findExtendTarget(
      scene(source, target),
      applyTransform(p(130, 20), transform),
      0.1,
    );
    expect(found?.status).toBe('ready');
    expect(found?.to?.x).toBeCloseTo(applyTransform(p(140, 20), transform).x, 9);
    expect(found?.to?.y).toBeCloseTo(applyTransform(p(140, 20), transform).y, 9);
    expect(found?.distanceMm).toBeCloseTo(20, 9);
  });
});
