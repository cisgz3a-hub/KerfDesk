import { describe, expect, it } from 'vitest';
import { singleLineTextToPolylines } from './single-line-text';

const BASE_INPUT = {
  content: 'IO',
  sizeMm: 21,
  alignment: 'left' as const,
  lineHeight: 1.4,
  letterSpacing: 0,
  color: '#000000',
};

describe('singleLineTextToPolylines', () => {
  it('renders character strokes as open one-tool-pass geometry', () => {
    const rendered = singleLineTextToPolylines(BASE_INPUT);
    const polylines = rendered.paths[0]?.polylines ?? [];

    expect(polylines.length).toBeGreaterThan(0);
    expect(polylines.every((polyline) => !polyline.closed)).toBe(true);
    expect(rendered.paths[0]?.curves?.every((curve) => !curve.closed)).toBe(true);
    expect(rendered.bounds.maxX).toBeGreaterThan(0);
    expect(rendered.bounds.maxY).toBeGreaterThan(0);
  });

  it('keeps an O as one stroke instead of inner and outer outlines', () => {
    const rendered = singleLineTextToPolylines({ ...BASE_INPUT, content: 'O' });

    expect(rendered.paths[0]?.polylines).toHaveLength(1);
  });

  it('aligns shorter lines against the longest line', () => {
    const left = singleLineTextToPolylines({ ...BASE_INPUT, content: 'I\nMMMM' });
    const right = singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'I\nMMMM',
      alignment: 'right',
    });

    expect(right.paths[0]?.polylines[0]?.points[0]?.x).toBeGreaterThan(
      left.paths[0]?.polylines[0]?.points[0]?.x ?? 0,
    );
  });
});
