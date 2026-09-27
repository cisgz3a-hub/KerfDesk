import { describe, expect, it } from 'vitest';
import type { ArrayPlacement } from '../../scene';
import type { DetectedPiece, PieceShape } from './find-pieces';
import { piecePlacements, pieceUnder, relativeRotationDeg } from './piece-placements';
import type { Point } from './rotated-rect';

function piece(
  x: number,
  y: number,
  axisDeg: number,
  shape: PieceShape = 'oblong',
  headingDeg: number | null = null,
): DetectedPiece {
  const [length, width] = shape === 'oblong' ? [80, 50] : [60, 60];
  const rad = (axisDeg * Math.PI) / 180;
  const corner = (a: number, b: number): Point => ({
    x: x + (a * length * Math.cos(rad)) / 2 - (b * width * Math.sin(rad)) / 2,
    y: y + (a * length * Math.sin(rad)) / 2 + (b * width * Math.cos(rad)) / 2,
  });
  return {
    outline: [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)],
    rect: { centre: { x, y }, axisDeg, length, width },
    areaMm2: length * width,
    centroid: { x, y },
    shape,
    headingDeg,
    partial: false,
  };
}

// Where a design point lands: moved, then turned about the pivot.
function land(point: Point, placement: ArrayPlacement): Point {
  const moved = { x: point.x + placement.dx, y: point.y + placement.dy };
  const pivot = placement.pivot;
  if (pivot === undefined) return moved;
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const dx = moved.x - pivot.x;
  const dy = moved.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

describe('relativeRotationDeg', () => {
  it('takes the smallest turn between long sides', () => {
    expect(relativeRotationDeg(piece(0, 0, 10), piece(0, 0, 40))).toBeCloseTo(30);
    expect(relativeRotationDeg(piece(0, 0, 10), piece(0, 0, 170))).toBeCloseTo(-20);
  });

  it('turns square pieces by at most an eighth of a turn', () => {
    expect(relativeRotationDeg(piece(0, 0, 5, 'square'), piece(0, 0, 85, 'square'))).toBeCloseTo(
      -10,
    );
  });

  it('never turns between round pieces without headings', () => {
    expect(relativeRotationDeg(piece(0, 0, 5, 'round'), piece(0, 0, 70, 'round'))).toBe(0);
  });

  it('lets headings choose the side that leads', () => {
    const from = piece(0, 0, 10, 'oblong', 190);
    const to = piece(0, 0, 40, 'oblong', 41);
    // The sides say 30° or 210°; the headings say about 211°.
    expect(relativeRotationDeg(from, to)).toBeCloseTo(-150);
  });
});

describe('piecePlacements', () => {
  const sample = piece(100, 100, 0);
  const others = [piece(250, 100, 30), piece(100, 250, 90)];

  it('keeps the design where it is on the sample and repeats it on the other pieces', () => {
    const placements = piecePlacements({
      pieces: [others[0] as DetectedPiece, sample, others[1] as DetectedPiece],
      design: { centre: { x: 110, y: 95 }, width: 40, height: 20, turnDeg: 0 },
      sample,
    });
    expect(placements[0]).toEqual({ dx: 0, dy: 0, rotationDeg: 0 });
    // A design point 10 mm right of the sample's centre lands 10 mm along
    // each piece's long side.
    const onFirst = land({ x: 110, y: 100 }, placements[1] as ArrayPlacement);
    expect(onFirst.x).toBeCloseTo(250 + 10 * Math.cos(Math.PI / 6));
    expect(onFirst.y).toBeCloseTo(100 + 10 * Math.sin(Math.PI / 6));
    const onSecond = land({ x: 110, y: 100 }, placements[2] as ArrayPlacement);
    expect(Math.abs(onSecond.x - 100)).toBeLessThan(1e-9);
    expect(Math.abs(Math.abs(onSecond.y - 250) - 10)).toBeLessThan(1e-9);
  });

  it('moves the design itself to the first piece when its own piece is left out', () => {
    const placements = piecePlacements({
      pieces: others,
      design: { centre: { x: 100, y: 100 }, width: 40, height: 20, turnDeg: 0 },
      sample,
    });
    expect(placements).toHaveLength(2);
    expect(placements[0]?.dx).toBeCloseTo(150);
    expect(placements[0]?.rotationDeg).toBeCloseTo(30);
  });

  it('centres the design on each piece, long side along the long side, with no sample', () => {
    const placements = piecePlacements({
      pieces: others,
      design: { centre: { x: 20, y: 30 }, width: 10, height: 40, turnDeg: 0 },
      sample: null,
    });
    const centre = land({ x: 20, y: 30 }, placements[0] as ArrayPlacement);
    expect(centre.x).toBeCloseTo(250);
    expect(centre.y).toBeCloseTo(100);
    // A tall design on a piece whose long side runs at 30°: turned by -60°.
    expect(placements[0]?.rotationDeg).toBeCloseTo(-60);
    expect(placements[1]?.rotationDeg).toBe(0);
    expect(placements[1]?.pivot).toBeUndefined();
  });
});

describe('pieceUnder', () => {
  it('finds the piece whose outline holds the point', () => {
    const pieces = [piece(100, 100, 0), piece(250, 100, 30)];
    expect(pieceUnder(pieces, { x: 255, y: 110 })).toBe(pieces[1]);
    expect(pieceUnder(pieces, { x: 175, y: 100 })).toBeNull();
  });
});
