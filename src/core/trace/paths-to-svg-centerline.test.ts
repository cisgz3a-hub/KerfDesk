import { describe, expect, it } from 'vitest';
import { polylineToCurveSubpath, type ColoredPath, type Polyline } from '../scene';
import { coloredPathsToSvg, countVisibleColoredPaths } from './paths-to-svg';

const line = (points: number[][], closed = true): Polyline => ({
  points: points.map(([x, y]) => ({ x: x!, y: y! })),
  closed,
});
const outer = line([
  [1.23456, 1],
  [11, 1],
  [11, 11],
  [1.23456, 11],
]);
const inner = line([
  [4, 4],
  [8, 4],
  [8, 8],
  [4, 8],
]);
const branch = line(
  [
    [11, 6],
    [14, 6],
  ],
  false,
);
const path = (polylines: Polyline[], color = '#000000'): ColoredPath => ({
  color,
  polylines,
  curves: polylines.map(polylineToCurveSubpath),
});
const elements = (svg: string) => [
  ...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('path'),
];

describe('explicit Centerline SVG paint', () => {
  it('strokes closed and open geometry while preserving every command, curve and input reference', () => {
    const paths = [path([outer, inner, branch]), path([outer], '#ff0000')];
    const before = structuredClone(paths);
    const filled = elements(coloredPathsToSvg(paths, 16, 16));
    const stroke = elements(coloredPathsToSvg(paths, 16, 16, undefined, 'centerline'));
    expect(stroke.map((p) => p.getAttribute('d'))).toEqual(filled.map((p) => p.getAttribute('d')));
    expect(stroke.map((p) => p.getAttribute('fill'))).toEqual(['none', 'none', 'none']);
    expect(stroke.map((p) => p.getAttribute('stroke'))).toEqual(['#000000', '#000000', '#ff0000']);
    expect(stroke[0]?.getAttribute('d')).toContain('Z M4 4');
    expect(stroke.every((p) => p.getAttribute('stroke-width') === '1')).toBe(true);
    expect(paths).toEqual(before);
    expect(paths[0]?.polylines[0]).toBe(outer);
    expect(countVisibleColoredPaths(paths, 'centerline')).toBe(2);
  });

  it('keeps physical dimensions, rounding and implicit filled/Edge defaults', () => {
    const paths = [path([outer, inner, branch])],
      size = { widthMm: 12.3456, heightMm: 6.789 };
    const plain = coloredPathsToSvg(paths, 16, 16, size);
    for (const mode of ['filled-contours', 'edge'] as const) {
      expect(coloredPathsToSvg(paths, 16, 16, size, mode)).toBe(plain);
    }
    const svg = coloredPathsToSvg(paths, 16, 16, size, 'centerline');
    expect(svg).toContain('width="12.35mm" height="6.79mm"');
    expect(svg).toContain('M1.23 1 L11 1');
    expect(plain).toContain('fill-rule="evenodd"');
    expect(elements(plain)[0]?.getAttribute('fill')).toBe('#000000');
  });

  it('counts and emits zero-area closed strokes by travel, independently from filled area', () => {
    const paths = [
      path([
        line([
          [1, 1],
          [4, 4],
        ]),
      ]),
      path(
        [
          line([
            [1, 1],
            [2, 2],
            [3, 3],
          ]),
        ],
        '#ff0000',
      ),
      path(
        [
          line([
            [1, 1],
            [4, 4],
            [1, 4],
            [4, 1],
          ]),
        ],
        '#0000ff',
      ),
    ];
    expect(countVisibleColoredPaths(paths)).toBe(0);
    expect(elements(coloredPathsToSvg(paths, 8, 8))).toHaveLength(0);
    expect(countVisibleColoredPaths(paths, 'centerline')).toBe(3);
    const output = elements(coloredPathsToSvg(paths, 8, 8, undefined, 'centerline'));
    expect(output).toHaveLength(3);
    expect(output.map((p) => p.getAttribute('d'))).toEqual([
      'M1 1 L4 4 Z',
      'M1 1 L2 2 L3 3 Z',
      'M1 1 L4 4 L1 4 L4 1 Z',
    ]);
  });

  it('preserves finite-point and background policies for empty and degenerate API inputs', () => {
    const invisible = [
      path([]),
      path([line([])]),
      path([
        line([
          [2, 2],
          [2, 2],
        ]),
      ]),
      path([
        line([
          [NaN, 3],
          [Infinity, 4],
        ]),
      ]),
      path([outer], '#ffffff'),
      path([outer], 'transparent'),
    ];
    for (const mode of [undefined, 'centerline'] as const) {
      expect(countVisibleColoredPaths(invisible, mode)).toBe(0);
      expect(elements(coloredPathsToSvg(invisible, 16, 16, undefined, mode))).toHaveLength(0);
    }
    const finite = path([
      line([
        [1, 2],
        [NaN, 0],
        [3, 4],
        [Infinity, 1],
      ]),
    ]);
    expect(
      elements(coloredPathsToSvg([finite], 8, 8, undefined, 'centerline'))[0]?.getAttribute('d'),
    ).toBe('M1 2 L3 4 Z');
  });
});
