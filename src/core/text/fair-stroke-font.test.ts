import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../scene';
import { CNC_STROKE_FONT_DATA } from './cnc-stroke-font-data';
import { fairStrokeFont, isPolylineDigitizedFont } from './fair-stroke-font';
import type { StrokeFont } from './stroke-font-text';
import { svgStrokeFont } from './svg-stroke-font';

const CAP_HEIGHT = 500;

describe('isPolylineDigitizedFont', () => {
  it('flags exactly the EMS faces, never Relief', () => {
    expect(isPolylineDigitizedFont('ems-nixish')).toBe(true);
    expect(isPolylineDigitizedFont('ems-decorous-script')).toBe(true);
    expect(isPolylineDigitizedFont('ems-casual-hand')).toBe(true);
    expect(isPolylineDigitizedFont('relief-single-line')).toBe(false);
  });

  it('matches the pinned data: EMS glyph paths are line-chain digitized', () => {
    for (const font of CNC_STROKE_FONT_DATA) {
      let lineCommands = 0;
      let cubicCommands = 0;
      for (const glyph of Object.values(font.glyphs)) {
        lineCommands += (glyph.path ?? '').match(/[LlHhVv]/g)?.length ?? 0;
        cubicCommands += (glyph.path ?? '').match(/[CcSs]/g)?.length ?? 0;
      }
      const lineDominated = lineCommands > cubicCommands * 10;
      expect(lineDominated, `${font.key} command census`).toBe(isPolylineDigitizedFont(font.key));
    }
  });
});

describe('fairStrokeFont', () => {
  it('turns a coarse arc chain into cubic segments that hug the samples', () => {
    // Quarter circle of radius 400 (letter-bowl scale) sampled every 15 deg —
    // the coarseness that makes EMS script letters look angular.
    const arc = arcChain(400, 0, Math.PI / 2, 7);
    const faired = fairOnePath(arc);

    expect(faired.segments.some((segment) => segment.kind === 'cubic')).toBe(true);
    expect(samePoint(faired.start, arc.start)).toBe(true);
    expect(samePoint(endPoint(faired), endPoint(arc))).toBe(true);
    // The fit must stay near the digitized chain (tolerance is 2% of the
    // path diagonal, capped at 2% of cap height = 10 units here; the fitter
    // guards at 4x tolerance).
    expect(maxDeviationFromChain(faired, chainPoints(arc))).toBeLessThan(CAP_HEIGHT * 0.08);
  });

  it('keeps hard drawn corners exactly in place', () => {
    // An L-shaped stroke with a curving tail: the 90 deg elbow must survive.
    const elbow: Vec2 = { x: 0, y: 400 };
    const path: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        { kind: 'line', to: { x: 0, y: 200 } },
        { kind: 'line', to: elbow },
        { kind: 'line', to: { x: 200, y: 400 } },
        { kind: 'line', to: { x: 300, y: 380 } },
        { kind: 'line', to: { x: 380, y: 330 } },
      ],
    };
    const faired = fairOnePath(path);
    const vertices = [faired.start, ...faired.segments.map((segment) => segment.to)];

    expect(vertices.some((vertex) => samePoint(vertex, elbow))).toBe(true);
  });

  it('passes short ticks and authored cubic paths through unchanged', () => {
    const tick: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [{ kind: 'line', to: { x: 30, y: 40 } }],
    };
    const authored: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 50, y: 0 },
          control2: { x: 100, y: 50 },
          to: { x: 100, y: 100 },
        },
        { kind: 'line', to: { x: 200, y: 100 } },
      ],
    };
    const font = strokeFont([tick, authored]);
    const faired = fairStrokeFont(font);

    expect(faired.glyphs.get('x')?.paths).toEqual([tick, authored]);
  });

  it('never closes an open machining stroke and preserves advances', () => {
    const data = CNC_STROKE_FONT_DATA.find((font) => font.key === 'ems-decorous-script');
    expect(data).toBeDefined();
    if (data === undefined) return;
    const native = svgStrokeFont(data);
    const faired = fairStrokeFont(native);

    expect(faired.capHeight).toBe(native.capHeight);
    expect(faired.glyphs.size).toBe(native.glyphs.size);
    let cubicSegments = 0;
    for (const [character, glyph] of faired.glyphs) {
      expect(glyph.advance).toBe(native.glyphs.get(character)?.advance);
      for (const path of glyph.paths) {
        expect(path.closed).toBe(false);
        for (const segment of path.segments) {
          expect(Number.isFinite(segment.to.x) && Number.isFinite(segment.to.y)).toBe(true);
          if (segment.kind === 'cubic') cubicSegments += 1;
        }
      }
    }
    expect(cubicSegments).toBeGreaterThan(0);
  });
});

function fairOnePath(path: CurveSubpath): CurveSubpath {
  const faired = fairStrokeFont(strokeFont([path])).glyphs.get('x')?.paths[0];
  expect(faired).toBeDefined();
  if (faired === undefined) throw new Error('fairStrokeFont dropped the test glyph path.');
  return faired;
}

function strokeFont(paths: ReadonlyArray<CurveSubpath>): StrokeFont {
  return {
    capHeight: CAP_HEIGHT,
    yAxis: 'up',
    glyphs: new Map([['x', { advance: 500, paths }]]),
  };
}

function arcChain(radius: number, from: number, to: number, steps: number): CurveSubpath {
  const point = (angle: number): Vec2 => ({
    x: radius * Math.cos(angle),
    y: radius * Math.sin(angle),
  });
  const segments = Array.from({ length: steps }, (_, index) => ({
    kind: 'line' as const,
    to: point(from + ((to - from) * (index + 1)) / steps),
  }));
  return { start: point(from), closed: false, segments };
}

function chainPoints(path: CurveSubpath): Vec2[] {
  return [path.start, ...path.segments.map((segment) => segment.to)];
}

function endPoint(path: CurveSubpath): Vec2 {
  return path.segments.at(-1)?.to ?? path.start;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
}

function maxDeviationFromChain(path: CurveSubpath, chain: ReadonlyArray<Vec2>): number {
  let worst = 0;
  let current = path.start;
  for (const segment of path.segments) {
    if (segment.kind === 'cubic') {
      for (let sample = 1; sample < 16; sample += 1) {
        const t = sample / 16;
        const m = 1 - t;
        const x =
          m ** 3 * current.x +
          3 * m * m * t * segment.control1.x +
          3 * m * t * t * segment.control2.x +
          t ** 3 * segment.to.x;
        const y =
          m ** 3 * current.y +
          3 * m * m * t * segment.control1.y +
          3 * m * t * t * segment.control2.y +
          t ** 3 * segment.to.y;
        worst = Math.max(worst, distanceToChain({ x, y }, chain));
      }
    }
    worst = Math.max(worst, distanceToChain(segment.to, chain));
    current = segment.to;
  }
  return worst;
}

function distanceToChain(point: Vec2, chain: ReadonlyArray<Vec2>): number {
  let best = Infinity;
  for (let index = 1; index < chain.length; index += 1) {
    const from = chain[index - 1];
    const to = chain[index];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const projection =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
          );
    best = Math.min(
      best,
      Math.hypot(point.x - (from.x + projection * dx), point.y - (from.y + projection * dy)),
    );
  }
  return best;
}
