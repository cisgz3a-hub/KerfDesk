import type * as opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath } from '../scene';
import { textOutlineGeometry, translateTextOutline } from './text-outline-path';

describe('textOutlineGeometry', () => {
  it('converts quadratic commands to equivalent canonical cubics', () => {
    const geometry = textOutlineGeometry([
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 6, y1: 12, x: 12, y: 0 },
      { type: 'Z' },
    ] as opentype.PathCommand[]);

    const curve = geometry.curves[0];
    const cubic = curve?.segments[0];
    expect(cubic).toMatchObject({
      kind: 'cubic',
      control1: { x: 4, y: 8 },
      control2: { x: 8, y: 8 },
      to: { x: 12, y: 0 },
    });
    expect(curve?.segments[1]).toEqual({ kind: 'line', to: { x: 0, y: 0 } });
    expect(curve?.closed).toBe(true);
  });

  it('keeps the sampled compatibility view close to the canonical curve', () => {
    const geometry = textOutlineGeometry([
      { type: 'M', x: 0, y: 0 },
      { type: 'C', x1: 0, y1: 10, x2: 10, y2: 10, x: 10, y: 0 },
    ] as opentype.PathCommand[]);
    const curve = geometry.curves[0];
    expect(curve).toBeDefined();
    const flattened = flattenCurveSubpath(curve!, { toleranceMm: 0.01 });
    expect(flattened.kind).toBe('ok');
    expect(geometry.polylines[0]?.points).toHaveLength(13);
    expect(geometry.polylines[0]?.points.at(-1)).toEqual({ x: 10, y: 0 });
  });

  it('translates endpoints and control points together', () => {
    const geometry = textOutlineGeometry([
      { type: 'M', x: 1, y: 2 },
      { type: 'C', x1: 3, y1: 4, x2: 5, y2: 6, x: 7, y: 8 },
    ] as opentype.PathCommand[]);
    const shifted = translateTextOutline(geometry, 10, -2);
    expect(shifted.curves[0]?.start).toEqual({ x: 11, y: 0 });
    expect(shifted.curves[0]?.segments[0]).toMatchObject({
      control1: { x: 13, y: 2 },
      control2: { x: 15, y: 4 },
      to: { x: 17, y: 6 },
    });
  });
});
