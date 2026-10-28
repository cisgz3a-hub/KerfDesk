import { describe, expect, it } from 'vitest';

import type { ColoredPath, CurveSubpath, PathSegment, Vec2 } from '../scene';
import { TRACE_PRESETS } from './trace-presets';
import type { RawImageData, TraceOptions } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';

// Binary shapes as quality audit Q4 drew them: a pixel is ink when its centre
// is inside, the shape centred off the pixel grid by (+0.31, +0.17).
type Shape = { readonly canvas: number; readonly inside: (x: number, y: number) => boolean };

function render(shape: Shape): RawImageData {
  const { canvas } = shape;
  const data = new Uint8ClampedArray(canvas * canvas * 4).fill(255);
  for (let y = 0; y < canvas; y += 1) {
    for (let x = 0; x < canvas; x += 1) {
      if (shape.inside(x + 0.5, y + 0.5)) data.set([0, 0, 0], (y * canvas + x) * 4);
    }
  }
  return { width: canvas, height: canvas, data };
}

function margin(size: number): number {
  return Math.max(6, Math.round(size * 0.25));
}

// size x 0.6 size with corner radius 0.15 size: a shape with no corners.
function roundedRect(size: number): Shape & { readonly distance: (p: Vec2) => number } {
  const canvas = size + 2 * margin(size);
  const cx = canvas / 2 + 0.31;
  const cy = canvas / 2 + 0.17;
  const r = 0.15 * size;
  const hx = size / 2 - r;
  const hy = 0.3 * size - r;
  const signed = (x: number, y: number): number => {
    const qx = Math.abs(x - cx) - hx;
    const qy = Math.abs(y - cy) - hy;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  return {
    canvas,
    inside: (x, y) => signed(x, y) < 0,
    distance: (p) => Math.abs(signed(p.x, p.y)),
  };
}

function polygon(
  size: number,
  vertices: ReadonlyArray<Vec2>,
): Shape & { readonly corners: Vec2[] } {
  const canvas = size + 2 * margin(size);
  const cx = canvas / 2 + 0.31;
  const cy = canvas / 2 + 0.17;
  const corners = vertices.map((v) => ({ x: v.x + cx, y: v.y + cy }));
  const inside = (x: number, y: number): boolean => {
    let odd = false;
    for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
      const p = corners[i] as Vec2;
      const q = corners[j] as Vec2;
      if (p.y > y !== q.y > y && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) odd = !odd;
    }
    return odd;
  };
  return { canvas, inside, corners };
}

function rotated(points: ReadonlyArray<Vec2>, degrees: number): Vec2[] {
  const a = (degrees * Math.PI) / 180;
  return points.map((p) => ({
    x: p.x * Math.cos(a) - p.y * Math.sin(a),
    y: p.x * Math.sin(a) + p.y * Math.cos(a),
  }));
}

// Square of side `size` turned 17 degrees.
function turnedSquare(size: number): ReturnType<typeof polygon> {
  const h = size / 2;
  return polygon(
    size,
    rotated(
      [
        { x: -h, y: -h },
        { x: h, y: -h },
        { x: h, y: h },
        { x: -h, y: h },
      ],
      17,
    ),
  );
}

// Isosceles triangle with that apex angle, longest side `size`, turned 7 degrees.
function triangle(apexDegrees: number): (size: number) => ReturnType<typeof polygon> {
  return (size) => {
    const half = (apexDegrees * Math.PI) / 360;
    const leg = Math.min(size, size / (2 * Math.sin(half)));
    const verts = [
      { x: 0, y: 0 },
      { x: leg * Math.sin(half), y: leg * Math.cos(half) },
      { x: -leg * Math.sin(half), y: leg * Math.cos(half) },
    ];
    const cy = (2 * leg * Math.cos(half)) / 3;
    return polygon(
      size,
      rotated(
        verts.map((p) => ({ x: p.x, y: p.y - cy })),
        7,
      ),
    );
  };
}

type Node = Vec2 & { readonly turnDeg: number };

function tangents(from: Vec2, segment: PathSegment): { readonly start: Vec2; readonly end: Vec2 } {
  const to = segment.to;
  if (segment.kind !== 'cubic') {
    const chord = { x: to.x - from.x, y: to.y - from.y };
    return { start: chord, end: chord };
  }
  const pick = (a: Vec2, b: Vec2, c: Vec2): Vec2 =>
    Math.hypot(a.x - b.x, a.y - b.y) > 1e-9 ? { x: a.x - b.x, y: a.y - b.y } : c;
  const chord = { x: to.x - from.x, y: to.y - from.y };
  return {
    start: pick(segment.control1, from, pick(segment.control2, from, chord)),
    end: pick(to, segment.control2, pick(to, segment.control1, chord)),
  };
}

// The joints of every closed outline with the turn the outline makes there.
function nodes(paths: ReadonlyArray<ColoredPath>): Node[] {
  const out: Node[] = [];
  for (const curve of paths.flatMap((path) => path.curves ?? []) as CurveSubpath[]) {
    const segments = curve.segments;
    const starts: Vec2[] = [];
    let at = curve.start;
    for (const segment of segments) {
      starts.push(at);
      at = segment.to;
    }
    for (let k = 0; k < segments.length; k += 1) {
      const prev = segments[(k - 1 + segments.length) % segments.length] as PathSegment;
      const prevFrom = starts[(k - 1 + segments.length) % segments.length] as Vec2;
      const incoming = tangents(prevFrom, prev).end;
      const outgoing = tangents(starts[k] as Vec2, segments[k] as PathSegment).start;
      const turn = Math.atan2(
        incoming.x * outgoing.y - incoming.y * outgoing.x,
        incoming.x * outgoing.x + incoming.y * outgoing.y,
      );
      out.push({ ...(starts[k] as Vec2), turnDeg: (Math.abs(turn) * 180) / Math.PI });
    }
  }
  return out;
}

const PRESETS = ['Line Art', 'Smooth'] as const;

function trace(image: RawImageData, preset: string): Promise<ColoredPath[]> {
  return traceImageToColoredPaths(image, TRACE_PRESETS[preset] as TraceOptions);
}

describe('binary corner apexes stay on the ink (ADR-439 Amendment 1)', () => {
  // Quality audit Q4-P2-2: leg apexes extrapolated past the pixels drew sharp
  // nodes 1 to 3.4 px off the true outline. A rounded rectangle has no corner,
  // so a sharp node more than a pixel off it is such a spike (natively, before
  // this bound: 1.8 px at 32 px, 2.6 px at 16 px, 2.5 px at 64 px).
  it.each([16, 32, 64])('draws no spike on a %i px rounded rectangle', async (size) => {
    const shape = roundedRect(size);
    for (const preset of PRESETS) {
      const sharp = nodes(await trace(render(shape), preset)).filter((n) => n.turnDeg >= 60);
      for (const node of sharp) expect(shape.distance(node)).toBeLessThan(1);
    }
  });

  // The bound must not withdraw true corners: without its leg slack it dropped
  // one corner of each of these.
  it.each([
    ['turned square', 64, turnedSquare],
    ['turned square', 200, turnedSquare],
    ['60 degree triangle', 32, triangle(60)],
    ['120 degree triangle', 32, triangle(120)],
  ] as const)('keeps every corner of a %s at %i px sharp', async (_name, size, make) => {
    const shape = make(size);
    for (const preset of PRESETS) {
      const sharp = nodes(await trace(render(shape), preset)).filter((n) => n.turnDeg >= 30);
      for (const corner of shape.corners) {
        const nearest = Math.min(...sharp.map((n) => Math.hypot(n.x - corner.x, n.y - corner.y)));
        expect(nearest).toBeLessThan(0.75);
      }
    }
  });
});
