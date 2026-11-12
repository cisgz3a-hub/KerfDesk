import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  flattenColoredPathCurves,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type SceneObject,
  type Vec2,
} from '../scene';
import { bendPointMapper, bendTextRender } from './text-bend';
import { placeTextOnPath } from './text-on-path';
import { textToPolylines, type TextRenderResult } from './text-to-polylines';
import { subdivideCurveForWarp } from './warp-subdivision';

// Oracle audit O7-P2-2: a warp must move every point of a glyph, not only the
// ends of its straight strokes.

function bytes(path: string): ArrayBuffer {
  const buffer = readFileSync(resolve(__dirname, path));
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}
const roboto = bytes('../../ui/text/fonts/Roboto-Regular.ttf');

function distanceToPolyline(point: Vec2, points: ReadonlyArray<Vec2>): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t =
      length === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    best = Math.min(best, Math.hypot(a.x + dx * t - point.x, a.y + dy * t - point.y));
  }
  return best;
}

/** Midpoints of every straight segment, as the unwarped text has them. */
function lineMidpoints(rendered: TextRenderResult): Vec2[] {
  const midpoints: Vec2[] = [];
  for (const curve of rendered.paths[0]?.curves ?? []) {
    let from = curve.start;
    for (const segment of curve.segments) {
      if (segment.kind === 'line') {
        midpoints.push({ x: (from.x + segment.to.x) / 2, y: (from.y + segment.to.y) / 2 });
      }
      from = segment.to;
    }
  }
  return midpoints;
}

function flattened(rendered: TextRenderResult): ReadonlyArray<ReadonlyArray<Vec2>> {
  const path = rendered.paths[0];
  if (path === undefined) return [];
  const flat = flattenColoredPathCurves(path, { toleranceMm: 0.005, segmentBudget: 1e7 });
  if (flat.kind !== 'ok') throw new Error('flatten failed');
  return flat.polylines.map((polyline) => polyline.points);
}

function worstMiss(targets: ReadonlyArray<Vec2>, outlines: ReadonlyArray<ReadonlyArray<Vec2>>) {
  return targets.reduce(
    (worst, target) =>
      Math.max(
        worst,
        outlines.reduce(
          (nearest, points) => Math.min(nearest, distanceToPolyline(target, points)),
          Number.POSITIVE_INFINITY,
        ),
      ),
    0,
  );
}

describe('text warps move every point of a glyph (O7-P2-2)', () => {
  it('bends a straight crossbar onto the arc, not across it as a chord', async () => {
    const text = await textToPolylines({
      content: 'HI',
      sizeMm: 50,
      alignment: 'left',
      lineHeight: 1.2,
      color: '#000000',
      fontBuffer: roboto,
    });
    const bent = bendTextRender(text, 180);
    const map = bendPointMapper(text.bounds, Math.PI);
    // Re-root the analytic map as bendTextRender re-roots its output.
    const raw = lineMidpoints(text).map(map);
    const corner = text.paths[0]?.curves?.[0]?.start;
    const offset = corner === undefined ? { x: 0, y: 0 } : diff(bentStart(bent), map(corner));
    const targets = raw.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y }));
    // Before subdivision the crossbar edge midpoints missed by 3.55 mm.
    expect(worstMiss(targets, flattened(bent))).toBeLessThan(0.02);
    // The sampled view follows the same arc.
    const polylines = (bent.paths[0]?.polylines ?? []).map((polyline) => polyline.points);
    expect(worstMiss(targets, polylines)).toBeLessThan(0.02);
  });

  it('keeps a straight stroke on a guide that turns a corner', () => {
    const guide = {
      kind: 'imported-svg',
      id: 'guide',
      source: 'guide.svg',
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 20 },
                { x: 20, y: 0 },
                { x: 40, y: 20 },
              ],
            },
          ],
        },
      ],
    } as unknown as SceneObject;
    const stroke: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [{ kind: 'line', to: { x: 20, y: 0 } }],
      closed: false,
    };
    const text: TextRenderResult = {
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 0 },
      paths: [
        {
          color: '#000000',
          polylines: [{ closed: false, points: [stroke.start, { x: 20, y: 0 }] }],
          curves: [stroke],
        },
      ],
    };
    const placed = placeTextOnPath(text, guide, {
      guideObjectId: 'guide',
      offsetMm: 18,
      reverse: false,
    } as never);
    expect(placed.kind).toBe('ok');
    if (placed.kind !== 'ok') return;
    // The stroke lies on the guide (baseline height 0), so its midpoint, 28 mm
    // along, is just before the corner at 28.28 mm: (19.80, 0.20) in guide space.
    const outline = flattened(placed.rendered);
    const along = 28;
    const leg = Math.SQRT1_2;
    const onGuide = { x: along * leg, y: 20 - along * leg };
    const rooted = { x: onGuide.x - placed.origin.x, y: onGuide.y - placed.origin.y };
    // Before subdivision the chord cut the corner and missed by 6.87 mm.
    expect(worstMiss([rooted], outline)).toBeLessThan(1e-6);
  });

  it('splits only where needed', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 0, y: 10 } },
        {
          kind: 'cubic',
          control1: { x: 1, y: 10 },
          control2: { x: 2, y: 10 },
          to: { x: 3, y: 10 },
        },
      ],
      closed: false,
    };
    // A vertical line never splits; a 3 mm cubic splits into 3 pieces of 1 mm.
    const split = subdivideCurveForWarp(curve, { maxStepX: 1 });
    expect(split.segments.map((segment) => segment.kind)).toEqual([
      'line',
      'cubic',
      'cubic',
      'cubic',
    ]);
    expect(split.segments.at(-1)?.to).toEqual({ x: 3, y: 10 });
  });
});

function bentStart(rendered: TextRenderResult): Vec2 {
  return rendered.paths[0]?.curves?.[0]?.start ?? { x: 0, y: 0 };
}

function diff(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
