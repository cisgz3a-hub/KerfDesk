// Line + fill preview paint (ADR-454): hybrid strokes draw as hairlines,
// hybrid outlines fill — per path, not per trace mode.

import { describe, expect, it } from 'vitest';
import { polylineToCurveSubpath, type ColoredPath, type Polyline } from '../scene';
import { HYBRID_FILL_COLOR, HYBRID_STROKE_COLOR } from './hybrid/hybrid-paths';
import { coloredPathsToSvg, countVisibleColoredPaths } from './paths-to-svg';

const square: Polyline = {
  points: [
    { x: 1, y: 1 },
    { x: 9, y: 1 },
    { x: 9, y: 9 },
    { x: 1, y: 9 },
  ],
  closed: true,
};
const pen: Polyline = {
  points: [
    { x: 9, y: 5 },
    { x: 15, y: 5 },
  ],
  closed: false,
};
const path = (color: string, polylines: Polyline[]): ColoredPath => ({
  color,
  polylines,
  curves: polylines.map(polylineToCurveSubpath),
});
const elements = (svg: string) => [
  ...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('path'),
];

describe('Line + fill SVG paint', () => {
  it('fills the outline path and strokes the pen path as a hairline', () => {
    const paths = [path(HYBRID_FILL_COLOR, [square]), path(HYBRID_STROKE_COLOR, [pen])];
    const drawn = elements(coloredPathsToSvg(paths, 16, 16, undefined, 'hybrid'));
    expect(drawn.map((p) => p.getAttribute('fill'))).toEqual([HYBRID_FILL_COLOR, 'none']);
    expect(drawn[1]?.getAttribute('stroke')).toBe(HYBRID_STROKE_COLOR);
    expect(drawn[1]?.getAttribute('stroke-width')).toBe('1');
    expect(countVisibleColoredPaths(paths, 'hybrid')).toBe(2);
  });

  it('strokes a closed pen ring (an O) instead of filling it', () => {
    const drawn = elements(
      coloredPathsToSvg([path(HYBRID_STROKE_COLOR, [square])], 16, 16, undefined, 'hybrid'),
    );
    expect(drawn.map((p) => p.getAttribute('fill'))).toEqual(['none']);
  });
});
