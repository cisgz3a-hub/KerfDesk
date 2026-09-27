// ADR-486: kerf decides holes across the whole line-mode layer. A contour inside
// another path's closed contour is a hole (inward offset), an island inside that
// hole is an outline again, and every path is still offset on its own so
// separate parts never merge.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Layer,
  type Polyline,
} from '../scene';
import { compileJob } from './compile-job';
import { validCutArcMoves } from './cut-arc-moves';
import type { CutSegment } from './job';
import { polylineBounds, type SegmentBounds } from './segment-bounds';

const COLOR = '#000000';
const KERF_MM = 1;
const ARC_DEVICE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };

function square(minX: number, minY: number, size: number): Polyline {
  return {
    points: [
      { x: minX, y: minY },
      { x: minX + size, y: minY },
      { x: minX + size, y: minY + size },
      { x: minX, y: minY + size },
    ],
    closed: true,
  };
}

function path(...polylines: Polyline[]): ColoredPath {
  return { color: COLOR, polylines };
}

function object(id: string, ...paths: ColoredPath[]): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

function kerfLayer(kerfOffsetMm = KERF_MM): Layer {
  return { ...createLayer({ id: 'cut', color: COLOR }), mode: 'line', kerfOffsetMm };
}

function cutSegments(
  objects: ReadonlyArray<ImportedSvg>,
  layer: Layer = kerfLayer(),
  device: DeviceProfile = DEFAULT_DEVICE_PROFILE,
): ReadonlyArray<CutSegment> {
  const job = compileJob({ objects, layers: [layer] }, device);
  const group = job.groups[0];
  if (group?.kind !== 'cut') throw new Error('expected one cut group');
  return group.segments;
}

// Widths of every output contour, largest first, rounded to the offset
// engine's 0.001 mm grid.
function widths(segments: ReadonlyArray<CutSegment>): number[] {
  return segments
    .map((segment) => round(width(polylineBounds(segment.polyline))))
    .sort((a, b) => b - a);
}

function width(bounds: SegmentBounds | null): number {
  if (bounds === null) throw new Error('empty segment');
  return bounds.maxX - bounds.minX;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const PLATE = square(0, 0, 100);
const HOLE = square(40, 40, 20);
const ISLAND = square(45, 45, 10);

describe('layer-wide kerf sides (ADR-486)', () => {
  it('shrinks a hole drawn as its own object, as it does inside one compound path', () => {
    const separate = cutSegments([object('plate', path(PLATE)), object('hole', path(HOLE))]);
    const compound = cutSegments([object('plate', path(PLATE, HOLE))]);
    expect(widths(separate)).toEqual([102, 18]);
    expect(widths(compound)).toEqual([102, 18]);
  });

  it('treats a separate path of the same object like a separate object', () => {
    expect(widths(cutSegments([object('sheet', path(PLATE), path(HOLE))]))).toEqual([102, 18]);
  });

  it('grows an island that sits inside a hole again', () => {
    const segments = cutSegments([
      object('plate', path(PLATE)),
      object('hole', path(HOLE)),
      object('island', path(ISLAND)),
    ]);
    expect(widths(segments)).toEqual([102, 18, 12]);
  });

  it('turns a whole compound path inward when it sits inside another object', () => {
    const ring = path(square(30, 30, 40), square(40, 40, 20));
    expect(widths(cutSegments([object('plate', path(PLATE)), object('ring', ring)]))).toEqual([
      102, 38, 22,
    ]);
  });

  it('offsets each ring by its own depth when another object sits between a path’s rings', () => {
    const frame = path(PLATE, ISLAND);
    const between = path(square(30, 30, 40));
    const segments = cutSegments([object('frame', frame), object('between', between)]);
    // Plate is an outline, the separate square inside it a hole, and the small
    // square inside that hole is an island again.
    expect(widths(segments)).toEqual([102, 38, 12]);
  });

  it('keeps separate parts apart and outward', () => {
    const segments = cutSegments([
      object('left', path(square(0, 0, 20))),
      object('right', path(square(20.5, 0, 20))),
    ]);
    expect(widths(segments)).toEqual([22, 22]);
  });

  it('keeps two coincident copies of a shape as outlines', () => {
    const segments = cutSegments([object('a', path(HOLE)), object('b', path(HOLE))]);
    expect(widths(segments)).toEqual([22, 22]);
  });

  it('leaves a layout with no nesting across paths exactly as before', () => {
    const objects = [object('plate', path(PLATE, HOLE)), object('part', path(square(120, 0, 30)))];
    expect(widths(cutSegments(objects))).toEqual([102, 32, 18]);
  });

  it('keeps each path’s contours where its segments were, among open paths', () => {
    const open: Polyline = {
      points: [
        { x: 0, y: 150 },
        { x: 50, y: 150 },
      ],
      closed: false,
    };
    const segments = cutSegments([
      object('first', path(open)),
      object('plate', path(PLATE)),
      object('last', path({ ...open, points: open.points.map((p) => ({ ...p, y: 160 })) })),
    ]);
    expect(segments.map((segment) => segment.closed)).toEqual([false, true, false]);
  });
});

const KAPPA = (4 / 3) * Math.tan(Math.PI / 8);

function circle(cx: number, cy: number, r: number): CurveSubpath {
  const k = KAPPA * r;
  const quarter = (
    c1: [number, number],
    c2: [number, number],
    to: [number, number],
  ): CurveSubpath['segments'][number] => ({
    kind: 'cubic',
    control1: { x: cx + c1[0], y: cy + c1[1] },
    control2: { x: cx + c2[0], y: cy + c2[1] },
    to: { x: cx + to[0], y: cy + to[1] },
  });
  return {
    start: { x: cx + r, y: cy },
    closed: true,
    segments: [
      quarter([r, k], [k, r], [0, r]),
      quarter([-k, r], [-r, k], [-r, 0]),
      quarter([-r, -k], [-k, -r], [0, -r]),
      quarter([k, -r], [r, -k], [r, 0]),
    ],
  };
}

function circleObject(): ImportedSvg {
  const curve = circle(50, 40, 10);
  return object('circle', {
    color: COLOR,
    polylines: [{ points: [curve.start], closed: true }],
    curves: [curve],
  });
}

describe('kerf-offset contours keep arcs (ADR-486)', () => {
  it('fits a kerf-offset circle with a few arcs on an arc-capable machine', () => {
    const [segment] = cutSegments([circleObject()], kerfLayer(0.1), ARC_DEVICE);
    if (segment === undefined) throw new Error('expected a segment');
    const moves = validCutArcMoves(segment);
    expect(moves).not.toBeNull();
    expect(moves?.length).toBeLessThanOrEqual(8);
    expect(moves?.filter((move) => move.kind === 'arc').length).toBeGreaterThanOrEqual(2);
    expect(round(width(polylineBounds(segment.polyline)))).toBeCloseTo(20.2, 1);
  });

  it('keeps the usual chords where tabs will cut the contour into pieces', () => {
    const tabbed = { ...kerfLayer(0.1), tabsEnabled: true };
    const withArcs = cutSegments([circleObject()], tabbed, ARC_DEVICE);
    const without = cutSegments([circleObject()], tabbed, DEFAULT_DEVICE_PROFILE);
    expect(withArcs.map((segment) => segment.polyline)).toEqual(
      without.map((segment) => segment.polyline),
    );
  });

  it('adds no arcs where the machine does not take them', () => {
    const [segment] = cutSegments([circleObject()], kerfLayer(0.1), DEFAULT_DEVICE_PROFILE);
    expect(segment?.arcMoves).toBeUndefined();
  });
});
