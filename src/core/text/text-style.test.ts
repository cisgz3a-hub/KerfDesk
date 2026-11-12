import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type SceneObject,
} from '../scene';
import { placeTextOnPath } from './text-on-path';
import {
  bendTextUndistorted,
  styledBentRender,
  styledTextContent,
  styleTextRender,
} from './text-style';
import type { TextRenderResult } from './text-to-polylines';

// Two 10 x 10 "glyphs" side by side, 5 mm apart, as squares.
function square(x: number): { polyline: Polyline; curve: CurveSubpath } {
  const points = [
    { x, y: 0 },
    { x: x + 10, y: 0 },
    { x: x + 10, y: 10 },
    { x, y: 10 },
  ];
  return {
    polyline: { points: [...points, points[0]!], closed: true },
    curve: {
      start: points[0]!,
      segments: points.slice(1).map((to) => ({ kind: 'line' as const, to })),
      closed: true,
    },
  };
}

function rendered(): TextRenderResult {
  const a = square(0);
  const b = square(15);
  const path: ColoredPath = {
    color: '#000000',
    polylines: [a.polyline, b.polyline],
    curves: [a.curve, b.curve],
  };
  return { paths: [path], bounds: { minX: 0, minY: 0, maxX: 25, maxY: 10 } };
}

describe('text style', () => {
  it('upper-cases and forces right-to-left on the laid-out content only', () => {
    expect(styledTextContent('ab\nc', { uppercase: true })).toBe('AB\nC');
    expect(styledTextContent('ab\n\nc', { forceRtl: true })).toBe(
      '\u202bab\u202c\n\n\u202bc\u202c',
    );
    expect(styledTextContent('ab', undefined)).toBe('ab');
  });

  it('squeezes to the max width keeping the height, and slants italic about the bottom', () => {
    const squeezed = styleTextRender(rendered(), { maxWidthMm: 20 }, 10);
    expect(squeezed.bounds).toMatchObject({ minX: 0, maxX: 20, minY: 0, maxY: 10 });
    expect(styleTextRender(rendered(), { maxWidthMm: 40 }, 10).bounds.maxX).toBe(25);
    const italic = styleTextRender(rendered(), { italic: true }, 10);
    const top = italic.paths[0]?.curves?.[0]?.start;
    expect(top?.x).toBeCloseTo(10 * Math.tan((12 * Math.PI) / 180), 9);
    expect(italic.paths[0]?.curves?.[0]?.segments[1]?.to.x).toBeCloseTo(10, 9);
  });

  it('grows outlines for bold', () => {
    const bold = styleTextRender(rendered(), { bold: true }, 10);
    expect(bold.bounds.minX).toBeCloseTo(-0.3, 2);
    expect(bold.paths[0]?.curves).toBeUndefined();
  });

  it('bends without distortion: each glyph keeps its size and turns as one piece', () => {
    const bent = bendTextUndistorted(rendered(), 90);
    const [first, second] = bent.paths[0]?.curves ?? [];
    for (const glyph of [first, second]) {
      const corners = [glyph!.start, ...glyph!.segments.map((segment) => segment.to)];
      const sides = corners.map((point, index) => {
        const next = corners[(index + 1) % corners.length]!;
        return Math.hypot(next.x - point.x, next.y - point.y);
      });
      sides.forEach((side) => expect(side).toBeCloseTo(10, 9));
    }
    // The two glyphs turn opposite ways about the middle of the text.
    const angle = (glyph: CurveSubpath) =>
      Math.atan2(glyph.segments[0]!.to.y - glyph.start.y, glyph.segments[0]!.to.x - glyph.start.x);
    expect(angle(first!)).toBeCloseTo(-angle(second!), 9);
    expect(bent.bounds.minX).toBe(0);
  });
});

describe('text style keeps the alignment anchor (rolling v7 L3)', () => {
  // A stem standing on the baseline (y 8) at each end; the right one is where
  // a right-aligned line ends, so the anchor sits at its foot.
  function stems(): TextRenderResult {
    const stem = (x: number): Polyline => ({
      closed: false,
      points: [
        { x, y: 0 },
        { x, y: 8 },
      ],
    });
    return {
      paths: [{ color: '#000000', polylines: [stem(2), stem(18)] }],
      glyphContours: [[0, 1]],
      bounds: { minX: 2, minY: 0, maxX: 18, maxY: 8 },
      anchor: { x: 18, y: 8 },
    };
  }

  it.each([60, -60])('lands a %s° rigid bend anchor on the foot of its glyph', (bend) => {
    const bent = bendTextUndistorted(stems(), bend);
    const foot = bent.paths[0]?.polylines[1]?.points[1];
    expect(bent.anchor?.x).toBeCloseTo(foot?.x ?? NaN, 12);
    expect(bent.anchor?.y).toBeCloseTo(foot?.y ?? NaN, 12);
  });

  // L3-P3-1: text in a frame squeezes about the frame's alignment point.
  it('squeezes framed text about the frame centre and other text about its left edge', () => {
    const framed: TextRenderResult = {
      ...rendered(),
      // Centred in a 25 mm frame: the squares fill it, so the frame centre is 12.5.
      anchor: { x: 12.5, y: 8 },
      textBoxLayout: {
        content: 'ab',
        sourceStarts: [0],
        sizeMm: 10,
        widthMm: 25,
        heightMm: 10,
        lineCount: 1,
        advanceWidthMm: 25,
        overflow: false,
      },
    };
    const squeezed = styleTextRender(framed, { maxWidthMm: 10 }, 10);
    expect((squeezed.bounds.minX + squeezed.bounds.maxX) / 2).toBeCloseTo(12.5, 12);
    expect(squeezed.anchor?.x).toBeCloseTo(12.5, 12);

    const plain = styleTextRender(rendered(), { maxWidthMm: 10 }, 10);
    expect(plain.bounds.minX).toBeCloseTo(0, 12);
    expect(plain.bounds.maxX).toBeCloseTo(10, 12);
  });
});

// Audit S7-P2-3 (ADR-691): bounds that spread every point into Math.min and
// Math.max threw "Maximum call stack size exceeded" past about 120,000 points.
// 450 characters of Great Vibes is about 236,000, so a long script paragraph
// crashed when styled, bent or put on a path. This drives all three over a
// text-sized point set: 2,000 closed glyph rings of 160 points each.
describe('styled, bent and placed text with a large point set', () => {
  const GLYPHS = 2000;
  const RING = 160;

  function manyGlyphs(): TextRenderResult {
    const polylines: Polyline[] = Array.from({ length: GLYPHS }, (_, glyph) => ({
      closed: true,
      points: Array.from({ length: RING }, (_, index) => {
        const turn = (index / RING) * 2 * Math.PI;
        return { x: glyph + 0.5 + 0.3 * Math.cos(turn), y: 0.5 + 0.3 * Math.sin(turn) };
      }),
    }));
    return {
      paths: [{ color: '#000000', polylines }],
      bounds: { minX: 0.2, minY: 0.2, maxX: GLYPHS - 0.2, maxY: 0.8 },
    };
  }

  function pointCount(result: TextRenderResult): number {
    return result.paths.reduce(
      (sum, path) => sum + path.polylines.reduce((inner, line) => inner + line.points.length, 0),
      0,
    );
  }

  // Squeezed to 1,600 mm and slanted, the rings still do not overlap in x, so
  // the rigid bend keeps 2,000 separate glyphs. A 90 degree arc of 1,600 mm has
  // a chord of 2 * (1600 / (pi / 2)) * sin(45 degrees), about 1,440 mm.
  it('styles and bends, distorting and rigid, without overflowing the stack', () => {
    const text = manyGlyphs();
    expect(pointCount(text)).toBe(GLYPHS * RING);
    for (const bendUndistorted of [false, true]) {
      const bent = styledBentRender(text, {
        bendDeg: 90,
        sizeMm: 10,
        textStyle: { italic: true, maxWidthMm: 1600, bendUndistorted },
      });
      expect(pointCount(bent)).toBe(GLYPHS * RING);
      expect(bent.bounds.minX).toBe(0);
      expect(bent.bounds.minY).toBe(0);
      expect(bent.bounds.maxX).toBeGreaterThan(1400);
      expect(bent.bounds.maxX).toBeLessThan(1500);
    }
  });

  it('places styled text on a path without overflowing the stack', () => {
    const styled = styleTextRender(manyGlyphs(), { italic: true }, 10);
    const placed = placeTextOnPath(styled, LONG_GUIDE, {
      guideObjectId: LONG_GUIDE.id,
      offsetMm: 0,
      reverse: false,
    });
    expect(placed.kind).toBe('ok');
    if (placed.kind !== 'ok') return;
    expect(pointCount(placed.rendered)).toBe(GLYPHS * RING);
    expect(placed.rendered.bounds.minX).toBeGreaterThanOrEqual(0);
    expect(placed.rendered.bounds.maxX).toBeGreaterThan(GLYPHS - 10);
  });
});

const LONG_GUIDE: SceneObject = {
  kind: 'imported-svg',
  id: 'long-guide',
  source: 'long-guide.svg',
  bounds: { minX: 0, minY: 0, maxX: 5000, maxY: 0 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 5000, y: 0 },
          ],
        },
      ],
    },
  ],
};
