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
import { segmentPoint } from './trim-curve-split';
import { trimEdit } from './trim-shape-edit';
import { createTrimSession, findTrimTarget } from './trim-shapes';

const p = (x: number, y: number): Vec2 => ({ x, y });
const arc: CurveSubpath = {
  start: p(10, 0),
  closed: false,
  segments: [
    {
      kind: 'elliptical-arc',
      radiusX: 10,
      radiusY: 10,
      rotationDeg: 0,
      largeArc: false,
      sweep: true,
      to: p(0, 10),
    },
  ],
};

function artwork(id: string, curve: CurveSubpath, transform: Transform): ImportedSvg {
  const flat = flattenCurveSubpath(curve, { toleranceMm: 0.025 });
  if (flat.kind !== 'ok') throw new Error('fixture must flatten');
  return {
    kind: 'imported-svg',
    id,
    source: id,
    transform,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    paths: [{ color: '#000000', polylines: [flat.polyline], curves: [curve] }],
  };
}

describe('Trim intersections with singular transformed arcs', () => {
  const cases = (['scaleX', 'scaleY'] as const).flatMap((axis) =>
    [0, 37].flatMap((rotationDeg) =>
      [false, true].map((mirrorX) => ({ axis, rotationDeg, mirrorX })),
    ),
  );
  it.each(cases)(
    'keeps the crossing at $axis=0, rotation=$rotationDeg, mirror=$mirrorX',
    ({ axis, rotationDeg, mirrorX }) => {
      const frame = { ...IDENTITY_TRANSFORM, x: 21, y: -13, rotationDeg, mirrorX };
      const collapsed = { ...frame, [axis]: 0 };
      const localExpected = axis === 'scaleX' ? p(0, 5) : p(5, 0);
      const expected = applyTransform(localExpected, frame);
      const line =
        axis === 'scaleX' ? { start: p(-5, 5), to: p(5, 5) } : { start: p(5, -5), to: p(5, 5) };
      const sourceLine = artwork(
        'line',
        { start: line.start, closed: false, segments: [{ kind: 'line', to: line.to }] },
        frame,
      );
      const sourceArc = artwork('arc', arc, collapsed);
      const scene: Scene = { objects: [sourceLine, sourceArc], layers: [], groups: [] };
      const session = createTrimSession(scene);
      for (const entry of session.model.entries) {
        const contour = session.model.contoursOf(entry)[0]!;
        const hits = session.crossingsOf(contour);
        expect(hits).toHaveLength(1);
        expect(hits[0]!.point.x).toBeCloseTo(expected.x, 6);
        expect(hits[0]!.point.y).toBeCloseTo(expected.y, 6);
      }
      const pickedLine = findTrimTarget(scene, applyTransform(line.start, frame), 0.025)!;
      expect(pickedLine.whole).toBe(false);
      const keptLine = trimEdit(sourceLine, pickedLine)!.paths[0]!.curves![0]!;
      expect(keptLine.start.x).toBeCloseTo(localExpected.x, 6);
      expect(keptLine.start.y).toBeCloseTo(localExpected.y, 6);
      const pickedArc = findTrimTarget(
        scene,
        applyTransform(segmentPoint(arc.start, arc.segments[0]!, 0.1), collapsed),
        0.025,
      )!;
      expect(pickedArc.contour.objectId).toBe('arc');
      expect(pickedArc.whole).toBe(false);
      const keptArc = trimEdit(sourceArc, pickedArc)!.paths[0]!.curves![0]!;
      const worldStart = applyTransform(keptArc.start, collapsed);
      expect(worldStart.x).toBeCloseTo(expected.x, 6);
      expect(worldStart.y).toBeCloseTo(expected.y, 6);
      expect(keptArc.segments[0]!.kind).toBe('elliptical-arc');
      expect(sourceArc.paths[0]!.curves![0]).toBe(arc);
    },
  );
});
