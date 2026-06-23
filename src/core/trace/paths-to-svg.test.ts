// Unit tests for the ColoredPath -> SVG stringifier. The preview
// renderer depends on the structure being parseable by the browser's
// SVG engine, so the tests pin the output shape rather than just
// counting characters.

import { describe, expect, it } from 'vitest';

import type { ColoredPath } from '../scene';
import { coloredPathsToSvg } from './paths-to-svg';

const SQUARE: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    },
  ],
};

const DONUT: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    },
    // Inner hole
    {
      closed: true,
      points: [
        { x: 3, y: 3 },
        { x: 7, y: 3 },
        { x: 7, y: 7 },
        { x: 3, y: 7 },
      ],
    },
  ],
};

describe('coloredPathsToSvg', () => {
  it('emits a self-contained <svg> with the correct viewBox', () => {
    const svg = coloredPathsToSvg([SQUARE], 10, 10);
    expect(svg).toMatch(/^<svg\b/);
    expect(svg).toMatch(/<\/svg>$/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 10 10"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it('can emit physical millimetre dimensions for standalone trace exports', () => {
    const svg = coloredPathsToSvg([SQUARE], 1000, 500, { widthMm: 100, heightMm: 50 });

    expect(svg).toContain('viewBox="0 0 1000 500"');
    expect(svg).toContain('width="100mm"');
    expect(svg).toContain('height="50mm"');
  });

  it('emits one <path> per ColoredPath with the layer colour', () => {
    const svg = coloredPathsToSvg([SQUARE], 10, 10);
    expect(svg).toContain('<path');
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('stroke="none"');
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it('emits a closed polyline as M ... L ... Z', () => {
    const svg = coloredPathsToSvg([SQUARE], 10, 10);
    expect(svg).toContain('M0 0 L10 0 L10 10 L0 10 Z');
  });

  it('omits Z on open polylines', () => {
    const open: ColoredPath = {
      color: '#ff0000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
        },
      ],
    };
    const svg = coloredPathsToSvg([open], 10, 10);
    expect(svg).toContain('M0 0 L5 5');
    expect(svg).not.toContain('Z"');
  });

  it('renders open polylines as stroked centerlines, not filled polygons', () => {
    const open: ColoredPath = {
      color: '#ff0000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
            { x: 10, y: 0 },
          ],
        },
      ],
    };
    const svg = coloredPathsToSvg([open], 10, 10);
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('stroke-linecap="round"');
  });

  it('concatenates multiple polylines in the same <path> d', () => {
    const svg = coloredPathsToSvg([DONUT], 10, 10);
    // Two subpaths joined with a space + M command.
    expect(svg).toContain('M0 0 L10 0 L10 10 L0 10 Z M3 3 L7 3 L7 7 L3 7 Z');
    // Still one <path> element, not two.
    expect((svg.match(/<path /g) ?? []).length).toBe(1);
  });

  it('emits one <path> per ColoredPath in multi-colour input', () => {
    const black: ColoredPath = { ...SQUARE, color: '#000000' };
    const red: ColoredPath = { ...SQUARE, color: '#ff0000' };
    const svg = coloredPathsToSvg([black, red], 10, 10);
    expect((svg.match(/<path /g) ?? []).length).toBe(2);
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('fill="#ff0000"');
  });

  it('rounds coordinates to 2 decimal places', () => {
    const wobbly: ColoredPath = {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 1.23456789, y: 2.345678 },
            { x: 9.999999, y: 4.001 },
            { x: 4.25, y: 8.75 },
          ],
        },
      ],
    };
    const svg = coloredPathsToSvg([wobbly], 10, 10);
    expect(svg).toContain('M1.23 2.35');
    expect(svg).toContain('L10 4');
  });

  it('handles empty ColoredPath[] (header + footer only)', () => {
    const svg = coloredPathsToSvg([], 100, 100);
    expect(svg).toMatch(/^<svg\b.+><\/svg>$/);
  });

  it('skips a ColoredPath whose polylines are empty', () => {
    const empty: ColoredPath = { color: '#000000', polylines: [] };
    const svg = coloredPathsToSvg([empty], 10, 10);
    expect(svg).not.toContain('<path ');
  });

  it('skips closed polylines with no filled area', () => {
    const degenerate: ColoredPath = {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 2, y: 2 },
            { x: 2, y: 2 },
            { x: 2, y: 2 },
          ],
        },
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
            { x: 10, y: 10 },
          ],
        },
      ],
    };

    const svg = coloredPathsToSvg([degenerate, SQUARE], 10, 10);

    expect(svg).not.toContain('M2 2 L2 2 L2 2 Z');
    expect(svg).not.toContain('M0 0 L5 5 L10 10 Z');
    expect(svg).toContain('M0 0 L10 0 L10 10 L0 10 Z');
  });

  it('skips open polylines with no travel length', () => {
    const zeroLength: ColoredPath = {
      color: '#ff0000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 4, y: 4 },
            { x: 4, y: 4 },
          ],
        },
      ],
    };

    const svg = coloredPathsToSvg([zeroLength], 10, 10);

    expect(svg).not.toContain('<path ');
  });
});
