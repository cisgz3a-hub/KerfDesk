import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Scene,
  type Transform,
  type Vec2,
} from '../scene';
import { flattenCurveSubpath } from '../scene/curve-path';
import { createTrimSession, findTrimTarget, type TrimTarget } from './trim-shapes';
import { trimEdit } from './trim-shape-edit';
import { segmentPoint } from './trim-curve-split';

const p = (x: number, y: number): Vec2 => ({ x, y });
const tangent: CurveSubpath = {
  start: p(0, 0.09),
  closed: false,
  // x(t)=10t, y(t)=(t-.3)^2. No sampled vertex sits at the tangent.
  segments: [
    {
      kind: 'cubic',
      control1: p(10 / 3, -0.11),
      control2: p(20 / 3, 0.09 - 0.4 + 1 / 3),
      to: p(10, 0.49),
    },
  ],
};
function line(
  id = 'line',
  start = p(0, 0),
  end = p(10, 0),
  transform = IDENTITY_TRANSFORM,
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id,
    transform,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 1 },
    paths: [{ color: '#000000', polylines: [{ points: [start, end], closed: false }] }],
  };
}
function curve(
  curve: CurveSubpath = tangent,
  transform: Transform = IDENTITY_TRANSFORM,
): ImportedSvg {
  const flat = flattenCurveSubpath(curve, { toleranceMm: 0.025 });
  if (flat.kind !== 'ok') throw new Error('fixture must flatten');
  return {
    ...line('curve', curve.start, curve.segments.at(-1)!.to, transform),
    paths: [{ color: '#000000', polylines: [flat.polyline], curves: [curve] }],
  };
}
const scene = (...objects: ImportedSvg[]): Scene => ({ objects, layers: [], groups: [] });
function crossings(s: Scene, id: string) {
  const session = createTrimSession(s);
  const entry = session.model.entries.find((candidate) => candidate.object.id === id)!;
  return session.crossingsOf(session.model.contoursOf(entry)[0]!);
}
function target(s: Scene, at: Vec2): TrimTarget {
  const result = findTrimTarget(s, at, 0.025);
  if (result === null) throw new Error('fixture must pick');
  return result;
}
function closePoint(actual: Vec2 | undefined, expected: Vec2): void {
  expect(actual).toBeDefined();
  expect(Math.hypot(actual!.x - expected.x, actual!.y - expected.y)).toBeLessThan(1e-6);
}

describe('analytic mixed Trim crossings', () => {
  it('finds the off-sample quadratic tangent once and trims either side of the line', () => {
    const source = line();
    const s = scene(source, curve());
    const hits = crossings(s, source.id);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.exact).toBe(true);
    closePoint(hits[0]?.point, p(3, 0));
    for (const [at, expectedStart, expectedEnd] of [
      [p(1, 0), p(3, 0), p(10, 0)],
      [p(9, 0), p(0, 0), p(3, 0)],
    ] as const) {
      const hit = target(s, at);
      expect(hit.whole).toBe(false);
      const kept = trimEdit(source, hit)?.paths[0]?.polylines[0];
      closePoint(kept?.points[0], expectedStart);
      closePoint(kept?.points.at(-1), expectedEnd);
      closePoint(at.x < 3 ? hit.highlight.at(-1) : hit.highlight[0], p(3, 0));
    }
  });

  it('uses the same exact parameter when the cubic is the trimmed source', () => {
    const source = curve();
    const s = scene(source, line());
    const hits = crossings(s, source.id);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.p).toBeCloseTo(0.3, 7);
    const segment = tangent.segments[0]!;
    const hit = target(s, segmentPoint(tangent.start, segment, 0.1));
    expect(hit.contour.objectId).toBe(source.id);
    const kept = trimEdit(source, hit)?.paths[0]?.curves?.[0];
    closePoint(kept?.start, p(3, 0));
    expect(kept?.segments[0]?.kind).toBe('cubic');
    closePoint(kept?.segments.at(-1)?.to, p(10, 0.49));
    closePoint(hit.highlight.at(-1), kept!.start);
    // The new curve is the exact t=.3..1 subcurve, not a chord replacement.
    closePoint(
      segmentPoint(kept!.start, kept!.segments[0]!, 0.5),
      segmentPoint(tangent.start, segment, 0.65),
    );
  });

  it('uses canonical bounds even when compatibility samples miss the tangent by more than the entry margin', () => {
    const source = curve();
    const coarse = {
      ...source,
      paths: [{ ...source.paths[0]!, polylines: [{ closed: false, points: [p(0, 1), p(10, 1)] }] }],
    };
    const s = scene(line(), coarse);
    expect(crossings(s, 'line')).toHaveLength(1);
    expect(target(s, p(1, 0)).whole).toBe(false);
    expect(crossings(s, 'curve')).toHaveLength(1);
  });

  it('rejects a true near miss and the infinite continuation beyond a finite boundary', () => {
    const segment = tangent.segments[0]!;
    if (segment.kind !== 'cubic') throw new Error('expected cubic');
    const shift = (point: Vec2) => p(point.x, point.y + 0.001);
    const above = {
      ...tangent,
      start: shift(tangent.start),
      segments: [
        {
          ...segment,
          control1: shift(segment.control1),
          control2: shift(segment.control2),
          to: shift(segment.to),
        },
      ],
    };
    expect(crossings(scene(line(), curve(above)), 'line')).toHaveLength(0);
    const short = scene(line('line', p(0, 0), p(2.9, 0)), curve());
    expect(crossings(short, 'line')).toHaveLength(0);
    expect(crossings(short, 'curve')).toHaveLength(0);
  });

  it('keeps three distinct cubic roots in both orientations', () => {
    const three: CurveSubpath = {
      start: p(0, -8),
      closed: false,
      segments: [
        { kind: 'cubic', control1: p(10 / 3, 14), control2: p(20 / 3, -14), to: p(10, 8) },
      ],
    };
    const s = scene(line(), curve(three));
    for (const id of ['line', 'curve']) {
      const hits = crossings(s, id);
      expect(hits).toHaveLength(3);
      [0.2, 0.5, 0.8].forEach((t, index) => expect(hits[index]?.p).toBeCloseTo(t, 8));
    }
  });

  it('preserves tangent locations under reflection, rotation and unequal scaling', () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      x: 21,
      y: -13,
      scaleX: 3,
      scaleY: 0.4,
      mirrorX: true,
      rotationDeg: 37,
    };
    const s = scene(line('line', p(0, 0), p(10, 0), transform), curve(tangent, transform));
    for (const id of ['line', 'curve']) {
      const hits = crossings(s, id);
      expect(hits).toHaveLength(1);
      closePoint(hits[0]?.point, applyTransform(p(3, 0), transform));
    }
    const hit = target(s, applyTransform(p(1, 0), transform));
    closePoint(
      trimEdit(s.objects[0] as ImportedSvg, hit)?.paths[0]?.polylines[0]?.points[0],
      p(3, 0),
    );
  });

  it('handles reversed line direction without reversing the curve parameter', () => {
    const s = scene(line('line', p(10, 0), p(0, 0)), curve());
    expect(crossings(s, 'line')[0]?.p).toBeCloseTo(0.7, 7);
    expect(crossings(s, 'curve')[0]?.p).toBeCloseTo(0.3, 7);
  });

  it('deduplicates true cubic tangency even with a long world-space baseline', () => {
    const transform = { ...IDENTITY_TRANSFORM, scaleX: 1000 };
    const s = scene(line('line', p(0, 0), p(10, 0), transform), curve(tangent, transform));
    for (const id of ['line', 'curve']) {
      const hits = crossings(s, id);
      expect(hits).toHaveLength(1);
      closePoint(hits[0]?.point, p(3000, 0));
    }
  });

  it('retains two real nearby roots without inventing a contact at their minimum', () => {
    const transform = { ...IDENTITY_TRANSFORM, scaleX: 1000, y: -1e-8 };
    const source = curve(tangent, transform);
    const s = scene(line('line', p(0, 0), p(10000, 0)), source);
    for (const id of ['line', 'curve']) {
      const hits = crossings(s, id);
      expect(hits).toHaveLength(2);
      closePoint(hits[0]?.point, p(2999, 0));
      closePoint(hits[1]?.point, p(3001, 0));
    }
  });

  it.each([false, true])(
    'finds an off-sample ellipse-arc tangency with clockwise=%s',
    (clockwise) => {
      const onEllipse = (degrees: number) =>
        p(5 + 5 * Math.cos((degrees * Math.PI) / 180), 3 + 3 * Math.sin((degrees * Math.PI) / 180));
      const start = clockwise ? -15 : -170;
      const end = clockwise ? -170 : -15;
      const arc: CurveSubpath = {
        start: onEllipse(start),
        closed: false,
        segments: [
          {
            kind: 'elliptical-arc',
            radiusX: 5,
            radiusY: 3,
            rotationDeg: 0,
            sweep: !clockwise,
            largeArc: false,
            to: onEllipse(end),
          },
        ],
      };
      const source = curve(arc);
      const s = scene(line(), source);
      for (const id of ['line', 'curve']) {
        const hits = crossings(s, id);
        expect(hits).toHaveLength(1);
        closePoint(hits[0]?.point, p(5, 0));
      }
      expect(crossings(s, 'curve')[0]?.p).toBeCloseTo(clockwise ? 75 / 155 : 80 / 155, 7);
      const hit = target(s, segmentPoint(arc.start, arc.segments[0]!, 0.1));
      const kept = trimEdit(source, hit)?.paths[0]?.curves?.[0];
      expect(kept!.segments[0]!.kind).toBe('elliptical-arc');
      closePoint(kept?.start, p(5, 0));
      closePoint(hit.highlight.at(-1), kept!.start);
    },
  );

  it('retains collinear no-crossing and open-end filtering policies', () => {
    const collinear: CurveSubpath = {
      start: p(0, 0),
      closed: false,
      segments: [{ kind: 'cubic', control1: p(2, 0), control2: p(8, 0), to: p(10, 0) }],
    };
    expect(crossings(scene(line(), curve(collinear)), 'line')).toHaveLength(0);
    expect(crossings(scene(line(), curve(collinear)), 'curve')).toHaveLength(0);
    const s = scene(line('line', p(3, 0), p(10, 0)), curve());
    expect(crossings(s, 'line')).toHaveLength(0);
    expect(crossings(s, 'curve')).toHaveLength(1);
  });
});
