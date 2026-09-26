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
    // At pixel scale 1 the enlarged hairline's 4×4 mask window is the blind
    // two-block tie; the wider 6×6 vote (ADR-403 amendment 1) reaches the
    // neighbouring steps (10 of 36 ink) and joins it, while the enlarged
    // board stays tied through 8×8 and keeps the tie-break.
    expect(createSaddleResolver(line, 'auto', null, 1)(6, 6)).toBe(true);
    expect(createSaddleResolver(board, 'auto', null, 1)(6, 6)).toBe(false);
  });

  it('widens a 4×4 tie to the 6×6 window (ADR-403 amendment 1)', () => {
    // Two 2×2 marks kissing at corner (4,4) on a page: the 4×4 window holds
    // exactly the two marks (8 of 16 ink), the 6×6 window adds 20 paper
    // pixels, so ink is the minority and the marks join.
    const marks = maskFrom([
      '........',
      '........',
      '..##....',
      '..##....',
      '....##..',
      '....##..',
      '........',
      '........',
    ]);
    expect(isSaddle(marks, 4, 4)).toBe(true);
    expect(createSaddleResolver(marks, 'auto')(4, 4)).toBe(true);
    // The same contact between two paper pinholes in solid ink: paper is the
    // 6×6 minority and keeps its diagonal, even where grey evidence in the
    // block would have joined the ink (the window outranks the decider).
    const holes = maskFrom([
      '########',
      '########',
      '##..####',
      '##..####',
      '####..##',
      '####..##',
      '########',
      '########',
    ]);
    const greyInk = Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: 8 }, (_, x) => {
        if ((x === 3 && y === 4) || (x === 4 && y === 3)) return 40;
        if ((x === 3 && y === 3) || (x === 4 && y === 4)) return 150;
        return holes.ink[y * 8 + x] === 1 ? 0 : 255;
      }),
    );
    expect(isSaddle(holes, 4, 4)).toBe(true);
    expect(createSaddleResolver(holes, 'auto', fieldFrom(greyInk, 128))(4, 4)).toBe(false);
    expect(createSaddleResolver(holes, 'connect-ink')(4, 4)).toBe(true);
  });

  it('widens a 6×6 tie to the 8×8 window', () => {
    // Two 3×3 marks kissing at corner (5,5): the 4×4 window holds 8 of 16
    // ink and the 6×6 window 18 of 36, both ties; the 8×8 window adds 28
    // paper pixels, so the marks join.
    const marks = maskFrom([
      '..........',
      '..........',
      '..###.....',
      '..###.....',
      '..###.....',
      '.....###..',
      '.....###..',
      '.....###..',
      '..........',
      '..........',
    ]);
    expect(isSaddle(marks, 5, 5)).toBe(true);
    expect(createSaddleResolver(marks, 'auto')(5, 5)).toBe(true);
    // Each wider window is measured in source pixels: enlarged 2x, the 8×8
    // source window is 16×16 mask pixels.
    const enlarged = maskFrom(
      [
        '..........',
        '..........',
        '..###.....',
        '..###.....',
        '..###.....',
        '.....###..',
        '.....###..',
        '.....###..',
        '..........',
        '..........',
      ].flatMap((row) => {
        const wide = row
          .split('')
          .map((c) => c + c)
          .join('');
        return [wide, wide];
      }),
    );
    expect(createSaddleResolver(enlarged, 'auto', null, 2)(10, 10)).toBe(true);
  });

  it('shrinks each wider window at the border, per axis and centred', () => {
    // Corner (2,4) of a 4-wide strip: the x half-size cannot grow past 2,
    // but y can, so the 6×6 window becomes 4×6 and the rows it adds decide.
    // Empty added rows: ink is the minority (8 of 24), the marks join.
    const sparse = maskFrom(['....', '....', '##..', '##..', '..##', '..##', '....', '....']);
    expect(isSaddle(sparse, 2, 4)).toBe(true);
    expect(createSaddleResolver(sparse, 'auto')(2, 4)).toBe(true);
    // Ink-filled added rows: ink is the majority inside the image (16 of
    // 24). Counting the out-of-image columns as paper would have made it the
    // minority (16 of 36) and joined it.
    const dense = maskFrom(['....', '####', '##..', '##..', '..##', '..##', '####', '....']);
    expect(createSaddleResolver(dense, 'auto')(2, 4)).toBe(false);
    // Two equal marks filling the whole image stay tied at every window
    // size (each shrinks to the image), so the tie-break decides.
    const kiss = maskFrom(['###...', '###...', '###...', '...###', '...###', '...###']);
    expect(createSaddleResolver(kiss, 'auto')(3, 3)).toBe(false);
  });

  it('leaves the grey decider and the tie-break only what 8×8 cannot decide', () => {
    // A 1-px checkerboard ties through 8×8 at every corner. With a
    // symmetric binary block the tie-break keeps paper joined; an
    // anti-aliased block past the margin still lets the decider join ink.
    const board = checkerboard(10, 10);
    const binary = createSaddleResolver(board, 'auto');
    expect(binary(5, 5)).toBe(false);
    const rows = Array.from({ length: 10 }, (_, y) =>
      Array.from({ length: 10 }, (_, x) => ((x + y) % 2 === 0 ? 30 : 225)),
    );
    expect(createSaddleResolver(board, 'auto', fieldFrom(rows, 131))(5, 5)).toBe(true);
    // The same decider evidence is not consulted where a wider window
    // decides: two 3×3 marks kissing on a page join at 8×8 even though the
    // saturated-free grey block below says paper.
    const marks = maskFrom([
      '..........',
      '..........',
      '..###.....',
      '..###.....',
      '..###.....',
      '.....###..',
      '.....###..',
      '.....###..',
      '..........',
      '..........',
    ]);
    const greyPaper = Array.from({ length: 10 }, (_, y) =>
      Array.from({ length: 10 }, (_, x) => {
        if ((x === 4 && y === 4) || (x === 5 && y === 5)) return 100;
        if ((x === 4 && y === 5) || (x === 5 && y === 4)) return 220;
        return marks.ink[y * 10 + x] === 1 ? 0 : 255;
      }),
    );
    expect(createSaddleResolver(marks, 'auto', fieldFrom(greyPaper, 128))(5, 5)).toBe(true);
  });

  it('lets a wider ring decide only when at least 7/8 of it is one colour', () => {
    // A 12×12 patch of 2-px checkerboard cells on a 20×20 page (the
    // topology.clean fixture's pattern). Next to the patch rim the wider
    // rings hold cells on one side and page on the other: (6,6) adds 15 of
    // 20 paper at 6×6 and 21 of 28 at 8×8 (3/4, not 7/8), so every rim
    // corner stays a tie and the tie-break keeps the cells apart. Counting
    // whole windows instead (6×6: 13 ink of 36) welded the rim.
    const patch = maskFrom(
      Array.from({ length: 20 }, (_, y) =>
        Array.from({ length: 20 }, (_, x) => {
          if (x < 4 || x >= 16 || y < 4 || y >= 16) return '.';
          return (((x - 4) >> 1) + ((y - 4) >> 1)) % 2 === 0 ? '#' : '.';
        }).join(''),
      ),
    );
    const resolve = createSaddleResolver(patch, 'auto');
    for (const [x, y] of [
      [6, 6],
      [6, 8],
      [8, 6],
      [6, 14],
      [14, 14],
      [12, 14],
    ] as const) {
      expect(isSaddle(patch, x, y)).toBe(true);
      expect(resolve(x, y)).toBe(false);
    }
    // One stray speck in an otherwise empty ring is still decisive: two
    // 2×2 marks kissing at (4,4) with a paper-ring speck (19 of 20 paper).
    const specked = maskFrom([
      '........',
      '.#......',
      '..##....',
      '..##....',
      '....##..',
      '....##..',
      '........',
      '........',
    ]);
    expect(createSaddleResolver(specked, 'auto')(4, 4)).toBe(true);
  });

  it('records that one flipped cell pixel can weld the patch rim', () => {
    // The 7/8 test clears the rim of the 2-px patch above by one pixel:
    // corner (14,6) adds 24 of 28 paper at 8×8 and the test needs 25. Turn
    // cell pixel (10,6) to paper and that ring decides, so the rim cells
    // join there (ADR-403 amendment 1 records this margin; topology.scan is
    // the fixture-level guard).
    const rows = Array.from({ length: 20 }, (_, y) =>
      Array.from({ length: 20 }, (_, x) => {
        if (x < 4 || x >= 16 || y < 4 || y >= 16) return '.';
        return (((x - 4) >> 1) + ((y - 4) >> 1)) % 2 === 0 ? '#' : '.';
      }),
    );
    expect(createSaddleResolver(maskFrom(rows.map((r) => r.join(''))), 'auto')(14, 6)).toBe(false);
    rows[6]![10] = '.';
    const noisy = maskFrom(rows.map((r) => r.join('')));
    expect(isSaddle(noisy, 14, 6)).toBe(true);
    expect(createSaddleResolver(noisy, 'auto')(14, 6)).toBe(true);
  });

  it('joins the centre of a small 1-px checkerboard patch on a page', () => {
    // In a 4×4 patch the 4×4 window is the balanced patch itself and the
    // 6×6 ring is all page, so the centre corner joins ink: a tiny dither
    // cluster is the minority. In an 8×8 patch the interior rings are
    // checkerboard too, so interior corners keep the tie-break.
    const patchOnPage = (n: number): InkMask =>
      maskFrom(
        Array.from({ length: 16 }, (_, y) =>
          Array.from({ length: 16 }, (_, x) => {
            const px = x - 4;
            const py = y - 4;
            if (px < 0 || py < 0 || px >= n || py >= n) return '.';
            return (px + py) % 2 === 0 ? '#' : '.';
          }).join(''),
        ),
      );
    const small = patchOnPage(4);
    expect(isSaddle(small, 6, 6)).toBe(true);
    expect(createSaddleResolver(small, 'auto')(6, 6)).toBe(true);
    const large = patchOnPage(8);
    for (const [x, y] of [
      [7, 7],
      [8, 8],
      [7, 9],
    ] as const) {
      expect(isSaddle(large, x, y)).toBe(true);
      expect(createSaddleResolver(large, 'auto')(x, y)).toBe(false);
    }
  });

  it('lets the 8×8 ring decide when the border clamps one axis', () => {
    // Corner (6,3) of a 12×6 image: the window can grow to 8 wide but stays
    // 6 tall. The 4×4 window ties (8 of 16) and the 6×6 ring is 10 of 20;
    // the 8×8 step adds only columns 2 and 9 (12 pixels, all paper), which
    // is decisive, so the ink minority joins.
    const rows = [
      '...######...',
      '...#..##....',
      '...#.#.#....',
      '...#..##....',
      '...###......',
      '............',
    ];
    const mask = maskFrom(rows);
    expect(isSaddle(mask, 6, 3)).toBe(true);
    expect(createSaddleResolver(mask, 'auto')(6, 3)).toBe(true);
    // The same 6×6 content as a 6×6 image: both axes are clamped at 6×6,
    // the vote stops, and the walker's out-of-image paper is not counted.
    const clamped = maskFrom(rows.map((row) => row.slice(3, 9)));
    expect(isSaddle(clamped, 3, 3)).toBe(true);
    expect(createSaddleResolver(clamped, 'auto')(3, 3)).toBe(false);
  });

  it('decides a ring that is exactly 7/8 one colour (pixel scale 2)', () => {
    // Two 2×2 source marks kissing at the corner, enlarged 2x: a 12×12 mask,
    // corner (6,6). The 4×4-source window (8×8 mask px) ties; the 6×6 ring
    // is 80 mask px. Ten ink pixels in it leave 70 paper, exactly 7/8
    // (4·60 = 3·80), which decides; eleven do not, and the 8×8 step is
    // clamped by the border, so that contact keeps the tie-break.
    const withRingInk = (count: number): InkMask =>
      maskFrom(
        Array.from({ length: 12 }, (_, y) =>
          Array.from({ length: 12 }, (_, x) => {
            if (y === 0 && x < count) return '#';
            const inFirst = x >= 2 && x < 6 && y >= 2 && y < 6;
            const inSecond = x >= 6 && x < 10 && y >= 6 && y < 10;
            return inFirst || inSecond ? '#' : '.';
          }).join(''),
        ),
      );
    expect(createSaddleResolver(withRingInk(10), 'auto', null, 2)(6, 6)).toBe(true);
    expect(createSaddleResolver(withRingInk(11), 'auto', null, 2)(6, 6)).toBe(false);
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
    // hairline is the window minority, so it stays joined (ADR-403).
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
