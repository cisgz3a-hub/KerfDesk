import { describe, expect, it } from 'vitest';
import { checkerboardFileName, checkerboardSvg } from './checkerboard-svg';

describe('checkerboardSvg', () => {
  it('sizes the page in true millimetres for the spec', () => {
    // 9×6 inner corners = 10×7 squares at 10mm + 10mm quiet zone each side.
    const svg = checkerboardSvg({ rows: 6, cols: 9 }, 10);
    expect(svg).toContain('width="120mm"');
    expect(svg).toContain('viewBox="0 0 120 104"'); // 90 board + 2×10 margin + caption band
    // 10×7 squares, half of them black (35).
    expect(svg.match(/<rect [^>]*fill="black"/g)).toHaveLength(35);
    expect(svg).toContain('9×6 inner corners · 10 mm squares');
    expect(svg).toContain('100 mm');
  });

  it('names the file after the board', () => {
    expect(checkerboardFileName({ rows: 6, cols: 9 }, 10)).toBe('checkerboard-9x6-10mm.svg');
  });
});
