import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Scene,
  type Vec2,
} from '../scene';
import { flattenCurveSubpath } from '../scene/curve-path';
import { extendEdit, findExtendTarget } from './extend-shapes';

const p = (x: number, y: number): Vec2 => ({ x, y });
function art(id: string, points: Vec2[], patch: Partial<ImportedSvg> = {}): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
    ...patch,
  };
}
function curveArt(id: string, curve: CurveSubpath, patch: Partial<ImportedSvg> = {}): ImportedSvg {
  const result = flattenCurveSubpath(curve, { toleranceMm: 0.025 });
  if (result.kind !== 'ok') throw new Error('fixture flatten failed');
  return art(id, [], {
    ...patch,
    paths: [{ color: '#000000', polylines: [result.polyline], curves: [curve] }],
  });
}
function scene(...objects: ImportedSvg[]): Scene {
  return {
    objects,
    layers: [createLayer({ id: 'cut', name: 'Cut', color: '#000000' })],
    groups: [],
  };
}
const source = () => art('source', [p(0, 0), p(10, 0)]);
const edge = (x: number, patch: Partial<ImportedSvg> = {}) =>
  art(`edge-${x}`, [p(x, -10), p(x, 10)], patch);

describe('Extend artwork', () => {
  it('chooses nearest forward boundary, independent of draw order, at either end', () => {
    const s = scene(source(), edge(40), edge(20), edge(-10));
    expect(findExtendTarget(s, p(10, 0), 0.1)).toMatchObject({
      status: 'ready',
      to: p(20, 0),
      distanceMm: 10,
      end: 'end',
    });
    expect(findExtendTarget(s, p(0, 0), 0.1)).toMatchObject({
      status: 'ready',
      to: p(-10, 0),
      end: 'start',
    });
  });
  it('does not pick interiors or closed contours', () => {
    expect(findExtendTarget(scene(source(), edge(20)), p(5, 0), 0.1)).toBeNull();
    const closed = art('closed', [p(0, 0), p(10, 0), p(10, 10)], {
      paths: [
        { color: '#000', polylines: [{ closed: true, points: [p(0, 0), p(10, 0), p(10, 10)] }] },
      ],
    });
    expect(findExtendTarget(scene(closed), p(0, 0), 0.1)).toBeNull();
  });
  it('ignores hidden targets but permits locked boundaries and never edits them', () => {
    const hidden = edge(15, { operationIds: ['hidden'] });
    const locked = edge(20, { locked: true });
    const initial = scene(source(), hidden, locked);
    const s = {
      ...initial,
      layers: [
        ...initial.layers,
        { ...createLayer({ id: 'hidden', name: 'Hidden', color: '#ff0000' }), visible: false },
      ],
    };
    expect(findExtendTarget(s, p(10, 0), 0.1)?.to).toEqual(p(20, 0));
    expect(
      findExtendTarget(scene({ ...source(), locked: true }, locked), p(10, 0), 0.1),
    ).toBeNull();
    expect(locked.paths[0]?.polylines[0]?.points).toEqual([p(20, -10), p(20, 10)]);
  });
  it('handles no hit, parallel boundaries, current contact, overlap, and endpoint contact', () => {
    expect(findExtendTarget(scene(source(), edge(-5)), p(10, 0), 0.1)?.status).toBe('no-boundary');
    expect(
      findExtendTarget(scene(source(), art('parallel', [p(20, 5), p(30, 5)])), p(10, 0), 0.1)
        ?.status,
    ).toBe('no-boundary');
    expect(findExtendTarget(scene(source(), edge(10), edge(20)), p(10, 0), 0.1)?.status).toBe(
      'already-touching',
    );
    expect(
      findExtendTarget(scene(source(), art('overlap', [p(20, 0), p(30, 0)])), p(10, 0), 0.1)
        ?.status,
    ).toBe('overlap');
    expect(
      findExtendTarget(scene(source(), art('endpoint', [p(20, 0), p(20, 5)])), p(10, 0), 0.1)?.to,
    ).toEqual(p(20, 0));
  });
  it('does not extend into another segment of its own contour', () => {
    const own = art('own', [p(20, -10), p(20, 10), p(0, 0), p(10, 0)]);
    expect(findExtendTarget(scene(own), p(10, 0), 0.1)?.status).toBe('no-boundary');
  });
  it('retains canonical cubic geometry when moving a straight terminal segment', () => {
    const curve: CurveSubpath = {
      start: p(0, 0),
      closed: false,
      segments: [
        { kind: 'cubic', control1: p(1, 10), control2: p(5, 10), to: p(5, 0) },
        { kind: 'line', to: p(10, 0) },
      ],
    };
    const object = curveArt('source', curve);
    const hit = findExtendTarget(scene(object, edge(20)), p(10, 0), 0.1);
    expect(hit?.status).toBe('ready');
    if (hit === null) throw new Error('missing extension');
    const edited = extendEdit(object, hit)?.[0];
    if (edited === undefined) throw new Error('missing edit');
    const resultCurve = edited.curves?.[0];
    expect(resultCurve?.segments[0]).toBe(curve.segments[0]);
    expect(resultCurve?.segments[1]?.to).toEqual(p(20, 0));
    expect(edited.polylines[0]?.points.at(-1)).toEqual(p(20, 0));
    expect(findExtendTarget(scene(object, edge(-10)), p(0, 0), 0.1)?.status).toBe('no-boundary');
  });
  it('intersects a cubic at its actual root, including a tangency', () => {
    // x(t)=15+10t; y(t)=12(t-1/2)^2: tangent at (20,0).
    const tangent = curveArt('tangent', {
      start: p(15, 3),
      closed: false,
      segments: [
        { kind: 'cubic', control1: p(15 + 10 / 3, -1), control2: p(15 + 20 / 3, -1), to: p(25, 3) },
      ],
    });
    const hit = findExtendTarget(scene(source(), tangent), p(10, 0), 0.1);
    expect(hit?.status).toBe('ready');
    expect(hit?.to?.x).toBeCloseTo(20, 8);
    expect(hit?.to?.y).toBe(0);
  });
  it('intersects a true elliptical arc and rejects the opposite half', () => {
    const left = curveArt('arc', {
      start: p(20, -5),
      closed: false,
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 5,
          radiusY: 5,
          rotationDeg: 0,
          largeArc: false,
          sweep: false,
          to: p(20, 5),
        },
      ],
    });
    const hit = findExtendTarget(scene(source(), left), p(10, 0), 0.1);
    expect(hit?.to?.x).toBeCloseTo(15, 8);
    const right = curveArt('arc', {
      start: p(20, -5),
      closed: false,
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 5,
          radiusY: 5,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: p(20, 5),
        },
      ],
    });
    expect(findExtendTarget(scene(source(), right), p(10, 0), 0.1)?.to?.x).toBeCloseTo(25, 8);
  });
  it('works in world coordinates under rotation, reflection and nonuniform scaling', () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      x: 7,
      y: 13,
      rotationDeg: 37,
      scaleX: 2,
      scaleY: 0.5,
      mirrorX: true,
    };
    const object = { ...source(), transform };
    const boundary = { ...edge(20), transform };
    const hit = findExtendTarget(scene(object, boundary), applyTransform(p(10, 0), transform), 0.1);
    expect(hit?.status).toBe('ready');
    const edit = hit === null ? null : extendEdit(object, hit);
    expect(edit?.[0]?.polylines[0]?.points.at(-1)?.x).toBeCloseTo(20, 8);
    expect(edit?.[0]?.polylines[0]?.points.at(-1)?.y).toBeCloseTo(0, 8);
  });
  it('rejects singular transforms, invalid pointer/tolerance, and stale edits', () => {
    expect(findExtendTarget(scene(source()), p(NaN, 0), 1)).toBeNull();
    expect(findExtendTarget(scene(source()), p(10, 0), Infinity)).toBeNull();
    const object = source();
    const hit = findExtendTarget(scene(object, edge(20)), p(10, 0), 0.1);
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(extendEdit(art('source', [p(0, 0), p(11, 0)]), hit)).toBeNull();
    expect(extendEdit(art('source', [p(10, -10), p(10, 0)]), hit)).toBeNull();
    expect(
      extendEdit({ ...object, transform: { ...IDENTITY_TRANSFORM, scaleY: 0 } }, hit),
    ).toBeNull();
  });

  it('appends or prepends a straight tangent without changing the original cubic', () => {
    const curve: CurveSubpath = {
      start: p(0, 0),
      closed: false,
      segments: [{ kind: 'cubic', control1: p(0, 5), control2: p(5, 0), to: p(10, 0) }],
    };
    const object = curveArt('source', curve);
    const s = scene(object, edge(20), art('bottom', [p(-5, -10), p(5, -10)]));
    for (const [at, expected, index] of [
      [p(10, 0), p(20, 0), 0],
      [p(0, 0), p(0, -10), 1],
    ] as const) {
      const target = findExtendTarget(s, at, 0.1);
      if (target === null) throw new Error('no tangent');
      expect(target.status).toBe('ready');
      expect(target.to).toEqual(expected);
      const edited = extendEdit(object, target)?.[0];
      const changed = edited?.curves?.[0];
      expect(changed?.segments).toHaveLength(2);
      expect(changed?.segments[index]).toBe(curve.segments[0]);
      expect(edited?.polylines[0]?.points).toContainEqual(at);
      expect(edited?.polylines[0]?.points).toContainEqual(expected);
      expect(
        extendEdit({ ...object, transform: { ...object.transform, mirrorY: true } }, target),
      ).toBeNull();
    }
  });

  it('continues an elliptical arc with its analytic endpoint tangent', () => {
    const curve: CurveSubpath = {
      start: p(0, 0),
      closed: false,
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 10,
          radiusY: 10,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: p(10, 10),
        },
      ],
    };
    const object = curveArt('arc', curve);
    const target = findExtendTarget(
      scene(object, art('top', [p(0, 20), p(20, 20)])),
      p(10, 10),
      0.1,
    );
    if (target === null) throw new Error('no arc tangent');
    expect(target.status).toBe('ready');
    expect(target.to?.x).toBeCloseTo(10, 8);
    expect(target.to?.y).toBeCloseTo(20, 8);
    const changed = extendEdit(object, target)?.[0]?.curves?.[0];
    expect(changed?.segments[0]).toBe(curve.segments[0]);
    expect(changed?.segments[1]?.kind).toBe('line');
  });

  it('uses the limiting tangent for a collapsed cubic endpoint handle', () => {
    const object = curveArt('cubic', {
      start: p(0, 0),
      closed: false,
      segments: [{ kind: 'cubic', control1: p(5, 0), control2: p(10, 0), to: p(10, 0) }],
    });
    expect(findExtendTarget(scene(object, edge(20)), p(10, 0), 0.1)?.to).toEqual(p(20, 0));
  });

  it('retains a tiny nonzero cubic handle direction under large scaling', () => {
    const object = {
      ...curveArt('cubic', {
        start: p(-1, -1),
        closed: false,
        segments: [{ kind: 'cubic', control1: p(0, -1), control2: p(-1e-8, 0), to: p(0, 0) }],
      }),
      transform: { ...IDENTITY_TRANSFORM, scaleX: 1e6 },
    };
    expect(findExtendTarget(scene(object, edge(20)), p(0, 0), 0.1)?.to).toEqual(p(20, 0));
  });
});
