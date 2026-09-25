import { describe, expect, it } from 'vitest';
import type { InkMask } from './centerline';
import {
  createSaddleResolver,
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

/** True when the 2×2 block at corner (x,y) is a saddle of the mask. */
function isSaddle(mask: InkMask, x: number, y: number): boolean {
  const at = (px: number, py: number): number => mask.ink[py * mask.width + px] ?? 0;
  const a = at(x - 1, y - 1);
  return a === at(x, y) && at(x, y - 1) === at(x - 1, y) && a !== at(x, y - 1);
}

function checkerboard(width: number, height: number): InkMask {
  const rows = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ((x + y) % 2 === 0 ? '#' : '.')).join(''),
  );
  return maskFrom(rows);
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
    // Corners (1,1) and (5,5) sit diagonally next to an image corner: see
    // the border case below.
    for (let k = 2; k <= 4; k += 1) {
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
    // Every corner sees an exact tie, including those near the image border,
    // where the window shrinks but stays centred on the corner; the
    // documented tie-break keeps the ink cells apart.
    for (const [width, height] of [
      [6, 6],
      [6, 4],
      [8, 6],
      [4, 4],
    ] as const) {
      const mask = checkerboard(width, height);
      const saddles = createSaddleResolver(mask, 'auto');
      for (let y = 1; y < height; y += 1)
        for (let x = 1; x < width; x += 1) {
          expect(isSaddle(mask, x, y)).toBe(true);
          expect(saddles(x, y), `${width}x${height} corner ${x},${y}`).toBe(false);
        }
    }
  });

  it('shrinks the window per axis, symmetrically, at the border', () => {
    // A hairline running into the left edge: at corner (1,3) only one column
    // fits either side, but the 2×4 window centred on the corner still sees
    // ink as the minority (2 of 8), so the line stays joined to the edge.
    const edge = maskFrom(['......', '......', '#.....', '.#....', '..#...', '...#..', '......']);
    expect(isSaddle(edge, 1, 3)).toBe(true);
    expect(createSaddleResolver(edge, 'auto')(1, 3)).toBe(true);
    // Diagonally next to an image corner only the corner's own 2×2 block
    // fits: a tie, so the binary answer is the tie-break (the one blind spot).
    const line = maskFrom(['#.....', '.#....', '..#...', '...#..', '....#.', '.....#']);
    expect(createSaddleResolver(line, 'auto')(1, 1)).toBe(false);
    const crack = maskFrom(['.#####', '#.####', '##.###', '###.##', '####.#', '#####.']);
    expect(createSaddleResolver(crack, 'auto')(1, 1)).toBe(false);
  });

  it('measures the window in source pixels on a supersampled mask', () => {
    // A 1-px hairline and a 1-px checkerboard enlarged 2x: inside a 4×4
    // mask window both are the same two 2×2 blocks kissing at a corner. The
    // 8×8 window (4×4 source pixels) tells them apart.
    const enlarge = (rows: ReadonlyArray<string>): string[] =>
      rows.flatMap((row) => {
        const wide = row
          .split('')
          .map((c) => c + c)
          .join('');
        return [wide, wide];
      });
    const line = maskFrom(enlarge(['#.....', '.#....', '..#...', '...#..', '....#.', '.....#']));
    const board = maskFrom(enlarge(['#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#']));
    expect(isSaddle(line, 6, 6)).toBe(true);
    expect(isSaddle(board, 6, 6)).toBe(true);
    expect(createSaddleResolver(line, 'auto', null, 2)(6, 6)).toBe(true);
    expect(createSaddleResolver(board, 'auto', null, 2)(6, 6)).toBe(false);
    // At pixel scale 1 the enlarged hairline's corner is a blind tie.
    expect(createSaddleResolver(line, 'auto', null, 1)(6, 6)).toBe(false);
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

  it('stays undecided on a symmetric saddle whose value sits near the cut', () => {
    // A symmetric anti-aliased checkerboard block (ink 30, paper 225): the
    // bilinear saddle value is the block mean, 127.5. Its sign flips between
    // cuts 127 and 128, so it is not evidence; both keep the tie-break.
    const board = maskFrom(['#.#.', '.#.#', '#.#.', '.#.#']);
    const rows = [0, 1, 2, 3].map((y) => [0, 1, 2, 3].map((x) => ((x + y) % 2 === 0 ? 30 : 225)));
    for (const cut of [126, 127, 128, 129])
      expect(createSaddleResolver(board, 'auto', fieldFrom(rows, cut))(2, 2), `cut ${cut}`).toBe(
        false,
      );
    // Past the margin the continuous model does decide.
    expect(createSaddleResolver(board, 'auto', fieldFrom(rows, 131))(2, 2)).toBe(true);
    expect(createSaddleResolver(board, 'auto', fieldFrom(rows, 124))(2, 2)).toBe(false);
  });

  it('reads a block pixel exactly on the cut as agreeing with either class', () => {
    // The brightness band's cut is inclusive (luma ≤ cut is ink) while the
    // global cut is strict, so a pixel at exactly the cut may be either
    // class in the mask. Residual 0 agrees with both. On the ink diagonal it
    // forces a non-negative saddle value (−r10·r01 / (r00 − r10 − r01) with
    // r00 < 0 < r10, r01), so the continuous model splits the ink: here
    // residuals −128 / +72 / +72 / 0 give +19.1, past the margin.
    const rows = [
      [0, 0, 255, 255],
      [0, 0, 200, 255],
      [255, 200, 128, 0],
      [255, 255, 0, 0],
    ];
    expect(createSaddleResolver(mask, 'auto', fieldFrom(rows, 128))(2, 2)).toBe(false);
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
