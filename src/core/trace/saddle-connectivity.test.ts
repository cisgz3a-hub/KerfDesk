import { describe, expect, it } from 'vitest';
import type { InkMask } from './centerline';
import {
  createSaddleResolver,
  isSaddle,
  normalizeTurnPolicy,
  type CrackSubPixelField,
} from './saddle-connectivity';

function maskFrom(rows: ReadonlyArray<string>): InkMask {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const ink = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x += 1) ink[y * width + x] = row[x] === '#' ? 1 : 0;
  });
  return { width, height, ink };
}

// Luma per pixel from a row-major grid, constant cut.
function fieldFrom(rows: ReadonlyArray<ReadonlyArray<number>>, cut: number): CrackSubPixelField {
  return {
    lumaAt: (x, y) => rows[y]?.[x] ?? 255,
    thresholdAt: () => cut,
  };
}

describe('saddle connectivity — binary 4×4 minority window', () => {
  it('joins a one-pixel diagonal hairline (ink is the local minority)', () => {
    const mask = maskFrom(['#.....', '.#....', '..#...', '...#..', '....#.', '.....#']);
    const saddles = createSaddleResolver(mask, 'auto');
    for (let k = 1; k <= 5; k += 1) {
      expect(isSaddle(mask, k, k)).toBe(true);
      expect(saddles(k, k)).toBe(true);
    }
  });

  it('keeps a one-pixel diagonal paper crack open (paper is the minority)', () => {
    const mask = maskFrom(['.#####', '#.####', '##.###', '###.##', '####.#', '#####.']);
    const saddles = createSaddleResolver(mask, 'auto');
    for (let k = 1; k <= 5; k += 1) expect(saddles(k, k)).toBe(false);
  });

  it('keeps two equal squares that kiss at one corner separate (a tie)', () => {
    const mask = maskFrom(['###...', '###...', '###...', '...###', '...###', '...###']);
    expect(isSaddle(mask, 3, 3)).toBe(true);
    expect(createSaddleResolver(mask, 'auto')(3, 3)).toBe(false);
  });

  it('resolves every saddle of a one-pixel checkerboard in favour of paper', () => {
    const mask = maskFrom(['#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#']);
    const saddles = createSaddleResolver(mask, 'auto');
    // Interior corners see an exact 8/16 tie; the documented tie-break keeps
    // the ink cells apart, so the topology is fully deterministic.
    for (let y = 2; y <= 4; y += 1)
      for (let x = 2; x <= 4; x += 1) expect(saddles(x, y)).toBe(false);
  });

  it('honours the explicit policies regardless of evidence', () => {
    const mask = maskFrom(['#.', '.#']);
    expect(createSaddleResolver(mask, 'connect-ink')(1, 1)).toBe(true);
    expect(createSaddleResolver(mask, 'connect-paper')(1, 1)).toBe(false);
  });

  it('treats unknown policy values as auto', () => {
    expect(normalizeTurnPolicy(undefined)).toBe('auto');
    expect(normalizeTurnPolicy('minority')).toBe('auto');
    expect(normalizeTurnPolicy('connect-ink')).toBe('connect-ink');
    expect(normalizeTurnPolicy('connect-paper')).toBe('connect-paper');
  });
});

describe('saddle connectivity — asymptotic decider on grey ties', () => {
  // Two 2×2 squares kiss at corner (2,2): the binary window ties 8/16, so
  // the anti-aliased grey levels of the kissing pixels decide.
  const mask = maskFrom(['##..', '##..', '..##', '..##']);
  const grey = (inkCore: number, paperCorner: number): number[][] => [
    [0, 0, 255, 255],
    [0, inkCore, paperCorner, 255],
    [255, paperCorner, inkCore, 0],
    [255, 255, 0, 0],
  ];

  it('joins the pair when the bilinear saddle value lies on the ink side', () => {
    // Residuals −88 (ink) / +22 (paper): saddle value
    // (−88·−88 − 22·22) / (−88 − 88 − 22 − 22) = −33 < 0 → ink joins.
    const saddles = createSaddleResolver(mask, 'auto', fieldFrom(grey(40, 150), 128));
    expect(saddles(2, 2)).toBe(true);
  });

  it('splits the pair when the bilinear saddle value lies on the paper side', () => {
    // Residuals −28 / +92: (784 − 8464) / (−240) = +32 > 0 → paper joins.
    const saddles = createSaddleResolver(mask, 'auto', fieldFrom(grey(100, 220), 128));
    expect(saddles(2, 2)).toBe(false);
  });

  it('ignores saturated (binary) blocks and keeps the tie-break', () => {
    const saddles = createSaddleResolver(mask, 'auto', fieldFrom(grey(0, 255), 128));
    expect(saddles(2, 2)).toBe(false);
  });

  it('falls back to the mask when a cleanup stage flipped a block pixel', () => {
    // The field says (1,1) is paper, the mask says ink: the decider must not
    // reason about a block the field no longer describes.
    const saddles = createSaddleResolver(mask, 'auto', fieldFrom(grey(200, 60), 128));
    expect(saddles(2, 2)).toBe(false);
  });

  it('never lets grey evidence break a thin diagonal hairline', () => {
    // A one-pixel anti-aliased diagonal whose core sits just under a low
    // cut: the bilinear saddle (≈ midpoint 110) reads as paper, but the
    // hairline is the window minority, so it stays joined (ADR-395).
    const line = maskFrom(['#...', '.#..', '..#.', '...#']);
    const rows = [
      [24, 195, 255, 255],
      [195, 24, 195, 255],
      [255, 195, 24, 195],
      [255, 255, 195, 24],
    ];
    const saddles = createSaddleResolver(line, 'auto', fieldFrom(rows, 25));
    expect(saddles(2, 2)).toBe(true);
  });
});
