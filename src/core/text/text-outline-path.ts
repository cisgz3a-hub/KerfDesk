import type * as opentype from 'opentype.js';
import type { CubicPathSegment, CurveSubpath, PathSegment, Polyline, Vec2 } from '../scene';

const CURVE_SAMPLES = 12;
const CLOSURE_EPS_MM = 1e-4;

export type TextOutlineGeometry = {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly curves: ReadonlyArray<CurveSubpath>;
};

// The exhaustive M/L/C/Q/Z parser keeps contour state in one place; splitting
// its switch would make close-path behavior harder to audit.
// eslint-disable-next-line complexity
export function textOutlineGeometry(
  commands: ReadonlyArray<opentype.PathCommand>,
): TextOutlineGeometry {
  const polylines: Polyline[] = [];
  const curves: CurveSubpath[] = [];
  let points: Vec2[] = [];
  let segments: PathSegment[] = [];
  let start: Vec2 | null = null;
  let current: Vec2 | null = null;

  const finish = (closedByCommand: boolean): void => {
    if (start !== null && points.length >= 2) {
      const last = points[points.length - 1];
      const geometricallyClosed = last !== undefined && samePoint(start, last);
      const closed = closedByCommand || geometricallyClosed;
      polylines.push({ points, closed });
      curves.push({ start, segments, closed });
    }
    points = [];
    segments = [];
    start = null;
    current = null;
  };

  for (const command of commands) {
    switch (command.type) {
      case 'M': {
        finish(false);
        const point = { x: command.x, y: command.y };
        points = [point];
        start = point;
        current = point;
        break;
      }
      case 'L': {
        if (current === null) break;
        const to = { x: command.x, y: command.y };
        points.push(to);
        segments.push({ kind: 'line', to });
        current = to;
        break;
      }
      case 'C': {
        if (current === null) break;
        const segment: CubicPathSegment = {
          kind: 'cubic',
          control1: { x: command.x1, y: command.y1 },
          control2: { x: command.x2, y: command.y2 },
          to: { x: command.x, y: command.y },
        };
        sampleCubic(points, current, segment);
        segments.push(segment);
        current = segment.to;
        break;
      }
      case 'Q': {
        if (current === null) break;
        const control = { x: command.x1, y: command.y1 };
        const to = { x: command.x, y: command.y };
        sampleQuadratic(points, current, control, to);
        segments.push(quadraticAsCubic(current, control, to));
        current = to;
        break;
      }
      case 'Z': {
        if (start !== null && current !== null && !samePoint(start, current)) {
          points.push(start);
          segments.push({ kind: 'line', to: start });
        }
        finish(true);
        break;
      }
    }
  }
  finish(false);
  return { polylines, curves };
}

export function translateTextOutline(
  geometry: TextOutlineGeometry,
  dx: number,
  dy: number,
): TextOutlineGeometry {
  const translate = (point: Vec2): Vec2 => ({ x: point.x + dx, y: point.y + dy });
  return {
    polylines: geometry.polylines.map((polyline) => ({
      points: polyline.points.map(translate),
      closed: polyline.closed,
    })),
    curves: geometry.curves.map((curve) => ({
      start: translate(curve.start),
      segments: curve.segments.map((segment) =>
        segment.kind === 'line'
          ? { ...segment, to: translate(segment.to) }
          : segment.kind === 'cubic'
            ? {
                ...segment,
                control1: translate(segment.control1),
                control2: translate(segment.control2),
                to: translate(segment.to),
              }
            : { ...segment, to: translate(segment.to) },
      ),
      closed: curve.closed,
    })),
  };
}

function quadraticAsCubic(from: Vec2, control: Vec2, to: Vec2): CubicPathSegment {
  return {
    kind: 'cubic',
    control1: {
      x: from.x + (2 / 3) * (control.x - from.x),
      y: from.y + (2 / 3) * (control.y - from.y),
    },
    control2: {
      x: to.x + (2 / 3) * (control.x - to.x),
      y: to.y + (2 / 3) * (control.y - to.y),
    },
    to,
  };
}

function sampleCubic(points: Vec2[], from: Vec2, segment: CubicPathSegment): void {
  for (let index = 1; index <= CURVE_SAMPLES; index += 1) {
    const t = index / CURVE_SAMPLES;
    const u = 1 - t;
    points.push({
      x:
        u ** 3 * from.x +
        3 * u * u * t * segment.control1.x +
        3 * u * t * t * segment.control2.x +
        t ** 3 * segment.to.x,
      y:
        u ** 3 * from.y +
        3 * u * u * t * segment.control1.y +
        3 * u * t * t * segment.control2.y +
        t ** 3 * segment.to.y,
    });
  }
}

function sampleQuadratic(points: Vec2[], from: Vec2, control: Vec2, to: Vec2): void {
  for (let index = 1; index <= CURVE_SAMPLES; index += 1) {
    const t = index / CURVE_SAMPLES;
    const u = 1 - t;
    points.push({
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    });
  }
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < CLOSURE_EPS_MM && Math.abs(a.y - b.y) < CLOSURE_EPS_MM;
}
