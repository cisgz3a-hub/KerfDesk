import { describe, expect, it } from 'vitest';
import type { ColoredPath, CurveSubpath, Polyline } from '../scene';
import { bendTextUndistorted, styledTextContent, styleTextRender } from './text-style';
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
