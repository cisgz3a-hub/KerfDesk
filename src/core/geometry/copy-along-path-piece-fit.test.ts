import { describe, expect, it } from 'vitest';
import { fitScaledGapPieces, type GapPiece } from './copy-along-path-piece-fit';

const PIECES: readonly GapPiece[] = [
  { start: 0, end: 50, extent: 20 },
  { start: 50, end: 200, extent: 3 },
  { start: 200, end: 240, extent: 12 },
];

describe('scaled gap piece runs', () => {
  it('matches an independent per-copy walk for growing and shrinking copies', () => {
    for (const lastScale of [0.01, 0.2, 3, 10]) {
      for (let count = 2; count <= 80; count += 1) {
        const expected = referencePositions(PIECES, count, lastScale);
        const result = fitScaledGapPieces({
          pieces: PIECES,
          start: 0,
          end: 240,
          gap: 2,
          count,
          lastScale,
          closed: false,
        });
        if (expected === null) expect(result).toBeNull();
        else {
          expect(result?.count).toBe(expected.length);
          expected.forEach((at, index) => expect(result?.at(index)).toBeCloseTo(at, 8));
        }
      }
    }
  });

  it('counts a trillion-copy trial using piece runs without allocating each position', () => {
    const result = fitScaledGapPieces({
      pieces: [
        { start: 0, end: 4e12, extent: 1 },
        { start: 4e12, end: 5e12, extent: 2 },
      ],
      start: 0,
      end: 5e12,
      gap: 1,
      count: 1e12,
      lastScale: 3,
      closed: false,
    });
    expect(result?.count).toBe(1e12);
    expect(result?.at(0)).toBe(0);
    expect(result?.at(1e12 - 1)).toBeCloseTo(3 * (1e12 - 1), 3);
  });
});

function referencePositions(pieces: readonly GapPiece[], count: number, lastScale: number) {
  const positions = [0];
  let currentExtent = pieces[0]!.extent;
  for (let index = 1; index < count; index += 1) {
    const current = positions.at(-1)!;
    const previousScale = 1 + ((lastScale - 1) * (index - 1)) / (count - 1);
    const scale = 1 + ((lastScale - 1) * index) / (count - 1);
    const candidates = pieces.flatMap((piece, pieceIndex) => {
      const at = Math.max(
        piece.start,
        current + 2 + (currentExtent * previousScale + piece.extent * scale) / 2,
      );
      return at >= current + 0.001 &&
        (at < piece.end || (pieceIndex === pieces.length - 1 && at <= piece.end + 1e-6))
        ? [{ at, extent: piece.extent }]
        : [];
    });
    const next = candidates[0];
    if (next === undefined) return null;
    positions.push(next.at);
    currentExtent = next.extent;
  }
  return positions;
}
