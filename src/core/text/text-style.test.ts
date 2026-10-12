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
