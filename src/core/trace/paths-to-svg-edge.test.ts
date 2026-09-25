import { describe, expect, it } from 'vitest';
import type { ColoredPath, Polyline } from '../scene';
import { coloredPathsToSvg, countVisibleColoredPaths } from './paths-to-svg';

// Edge Detection commits as a LINE layer (scene-mutations layer-mode policy),
// so its preview must show the outlines that burn, not filled silhouettes.
const ring = (x0: number, y0: number, x1: number, y1: number): Polyline => ({
  closed: true,
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
});
const edgeResult: ColoredPath[] = [
  {
    color: '#000000',
    polylines: [
      ring(1, 1, 11, 11),
      ring(4, 4, 8, 8),
      {
        closed: false,
        points: [
          { x: 11, y: 6 },
          { x: 14, y: 6 },
        ],
      },
    ],
  },
];
const paths = (svg: string) => [
  ...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('path'),
];

describe('Edge Detection SVG paint', () => {
  it('strokes every ring and open edge as a hairline instead of filling the rings', () => {
    const output = paths(coloredPathsToSvg(edgeResult, 16, 16, undefined, 'edge'));
    expect(output.length).toBeGreaterThan(0);
    for (const path of output) {
      expect(path.getAttribute('fill')).toBe('none');
      expect(path.getAttribute('stroke')).toBe('#000000');
      expect(path.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      expect(path.getAttribute('fill-rule')).toBeNull();
    }
    const d = output.map((path) => path.getAttribute('d')).join(' ');
    expect(d).toContain('M1 1 L11 1 L11 11 L1 11 Z');
    expect(d).toContain('M4 4 L8 4 L8 8 L4 8 Z');
    expect(d).toContain('M11 6 L14 6');
  });

  it('keeps filled contours filled, with their open strokes also drawn as hairlines', () => {
    const output = paths(coloredPathsToSvg(edgeResult, 16, 16, undefined, 'filled-contours'));
    expect(output.map((path) => path.getAttribute('fill'))).toEqual(['#000000', 'none']);
    expect(output[0]?.getAttribute('fill-rule')).toBe('evenodd');
    expect(output[0]?.getAttribute('vector-effect')).toBeNull();
    expect(output[1]?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it('counts a zero-area Edge ring by its travel, as the LINE layer burns it', () => {
    const flat: ColoredPath = {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 1, y: 1 },
            { x: 5, y: 5 },
          ],
        },
      ],
    };
    expect(countVisibleColoredPaths([flat], 'filled-contours')).toBe(0);
    expect(countVisibleColoredPaths([flat], 'edge')).toBe(1);
    expect(paths(coloredPathsToSvg([flat], 8, 8, undefined, 'edge'))).toHaveLength(1);
  });
});
