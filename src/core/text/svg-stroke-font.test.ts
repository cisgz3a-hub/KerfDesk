import { describe, expect, it } from 'vitest';
import { parseSvgStrokePath } from './svg-stroke-font';

describe('parseSvgStrokePath', () => {
  it('preserves separate moves, lines, cubics, and exponent coordinates', () => {
    const paths = parseSvgStrokePath('M 1 2 L 3 4 M 5 6 C 7 8 9 10 1e+1 12');

    expect(paths).toEqual([
      {
        start: { x: 1, y: 2 },
        closed: false,
        segments: [{ kind: 'line', to: { x: 3, y: 4 } }],
      },
      {
        start: { x: 5, y: 6 },
        closed: false,
        segments: [
          {
            kind: 'cubic',
            control1: { x: 7, y: 8 },
            control2: { x: 9, y: 10 },
            to: { x: 10, y: 12 },
          },
        ],
      },
    ]);
  });

  it('handles Relief relative lines, smooth cubics, and source close commands', () => {
    const [path] = parseSvgStrokePath('M10 10h5v5l-2 3c1 2 3 4 5 6s7 8 9 10z');

    expect(path).toEqual({
      start: { x: 10, y: 10 },
      closed: false,
      segments: [
        { kind: 'line', to: { x: 15, y: 10 } },
        { kind: 'line', to: { x: 15, y: 15 } },
        { kind: 'line', to: { x: 13, y: 18 } },
        {
          kind: 'cubic',
          control1: { x: 14, y: 20 },
          control2: { x: 16, y: 22 },
          to: { x: 18, y: 24 },
        },
        {
          kind: 'cubic',
          control1: { x: 20, y: 26 },
          control2: { x: 25, y: 32 },
          to: { x: 27, y: 34 },
        },
        { kind: 'line', to: { x: 10, y: 10 } },
      ],
    });
  });

  it('treats coordinate pairs after a move as implicit line segments', () => {
    expect(parseSvgStrokePath('M0 0 5 5 10 0')).toEqual([
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [
          { kind: 'line', to: { x: 5, y: 5 } },
          { kind: 'line', to: { x: 10, y: 0 } },
        ],
      },
    ]);
  });

  it('rejects coordinates before a move and unsupported path commands', () => {
    expect(() => parseSvgStrokePath('1 2 L 3 4')).toThrow('must start with a command');
    expect(() => parseSvgStrokePath('M0 0 A5 5 0 0 0 10 10')).toThrow('unsupported command "A"');
  });

  it('rejects incomplete coordinate groups', () => {
    expect(() => parseSvgStrokePath('M0 0 C1 2 3')).toThrow('incomplete C command');
  });
});
