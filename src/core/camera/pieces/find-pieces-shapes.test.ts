// Find pieces on blanks with a waist, a knot or a hole, and on tiles laid a
// hairline apart (ADR-442 Amendment 3, camera audit v2 K6): #1925's neck cut
// split one waisted blank into two pieces, and a dark knot read as a hole.
// Synthetic top-down pictures; no camera.

import { describe, expect, it } from 'vitest';
import { findPieces, MIN_PIECE_AREA_MM2, type DetectedPiece } from './find-pieces';
import {
  onRenderedPiece,
  PLYWOOD,
  renderBedPicture,
  type Colour,
  type RenderedPiece,
} from './piece-render-fixtures';
import type { Point } from './rotated-rect';

const REGION = { x: 0, y: 0, width: 300, height: 220 };
const PPM = 2;
// Each scene renders and searches a whole picture.
const SCENE_TIMEOUT_MS = 60_000;
const BED_CORNER = { x: 4, y: 216 };

function square(x: number, y: number, side: number): RenderedPiece {
  return {
    kind: 'rect',
    centre: { x, y },
    length: side,
    width: side,
    angleDeg: 0,
    colour: PLYWOOD,
  };
}

function find(pieces: ReadonlyArray<RenderedPiece>, bed: () => Colour): DetectedPiece[] {
  const image = renderBedPicture({ region: REGION, pixelsPerMm: PPM, pieces, noise: 2, bed });
  return findPieces({
    image,
    region: REGION,
    pixelsPerMm: PPM,
    reference: BED_CORNER,
    minAreaMm2: MIN_PIECE_AREA_MM2,
  });
}

describe('blanks with a waist, a knot or a hole stay one piece each', () => {
  const darkBed = (): Colour => [55, 58, 60];
  const KNOT: Colour = [90, 60, 36];
  const centres = [
    { x: 60, y: 60 },
    { x: 160, y: 60 },
    { x: 250, y: 60 },
    { x: 60, y: 160 },
    { x: 160, y: 160 },
    { x: 250, y: 160 },
  ];
  const disc = (x: number, y: number, radius: number, colour = PLYWOOD): RenderedPiece => ({
    kind: 'disc',
    centre: { x, y },
    radius,
    colour,
  });
  const shapes: Record<string, (c: Point) => RenderedPiece[]> = {
    'bone tags (30 mm lobes, 14 mm neck)': (c) => [
      disc(c.x - 17, c.y, 15),
      disc(c.x + 17, c.y, 15),
      { kind: 'rect', centre: c, length: 34, width: 14, angleDeg: 0, colour: PLYWOOD },
    ],
    'peanut offcuts': (c) => [disc(c.x - 15, c.y, 20), disc(c.x + 15, c.y, 20)],
    'guitar offcuts': (c) => [disc(c.x - 15, c.y, 25), disc(c.x + 20, c.y, 20)],
    'snowman ornaments': (c) => [disc(c.x - 18, c.y, 14), disc(c.x + 14, c.y, 20)],
  };

  // The ticked pieces whose placement point lies on each blank.
  function copiesPerBlank(
    pieces: ReadonlyArray<DetectedPiece>,
    blanks: ReadonlyArray<RenderedPiece[]>,
  ) {
    const ticked = pieces.filter((piece) => !piece.partial && piece.doubt === undefined);
    return blanks.map(
      (parts) =>
        ticked.filter((piece) => {
          const at = piece.onMaterial ?? piece.rect.centre;
          return parts.some((part) => onRenderedPiece(part, at.x, at.y));
        }).length,
    );
  }

  for (const [name, shape] of Object.entries(shapes)) {
    it(
      `finds ${name} one piece each, one copy per blank`,
      () => {
        const blanks = centres.map(shape);
        const pieces = find(blanks.flat(), darkBed);
        expect(pieces).toHaveLength(6);
        expect(copiesPerBlank(pieces, blanks)).toEqual([1, 1, 1, 1, 1, 1]);
      },
      SCENE_TIMEOUT_MS,
    );
  }

  it(
    'still finds tiles laid 1 mm apart one by one, across the seams the close bridged',
    () => {
      const tiles: RenderedPiece[] = [];
      for (let j = 0; j < 2; j += 1) {
        for (let i = 0; i < 4; i += 1) tiles.push(square(60 + i * 51, 70 + j * 51, 50));
      }
      const pieces = find(tiles, darkBed);
      expect(pieces).toHaveLength(8);
      expect(
        copiesPerBlank(
          pieces,
          tiles.map((tile) => [tile]),
        ),
      ).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    },
    SCENE_TIMEOUT_MS,
  );

  it(
    'finds hourglass offcuts one piece each',
    () => {
      const blanks = [
        { x: 80, y: 110 },
        { x: 210, y: 110 },
      ].map((c) => [disc(c.x - 20, c.y, 30), disc(c.x + 20, c.y, 30)]);
      const pieces = find(blanks.flat(), darkBed);
      expect(pieces).toHaveLength(2);
      expect(copiesPerBlank(pieces, blanks)).toEqual([1, 1]);
    },
    SCENE_TIMEOUT_MS,
  );

  it(
    'counts a dark knot as the blank\u2019s own wood: no hole, no cut, centred',
    () => {
      const blanks = centres.map((c, k) => [
        ...(k % 2 === 1 ? [disc(c.x, c.y, 5, KNOT)] : []),
        {
          kind: 'rect',
          centre: c,
          length: 70,
          width: 70,
          angleDeg: 0,
          colour: PLYWOOD,
        } as RenderedPiece,
      ]);
      const pieces = find(blanks.flat(), darkBed);
      expect(pieces).toHaveLength(6);
      for (const piece of pieces) {
        expect(piece.holes ?? []).toHaveLength(0);
        expect(piece.doubt).toBeUndefined();
        const at = piece.onMaterial ?? piece.rect.centre;
        expect(Math.hypot(at.x - piece.rect.centre.x, at.y - piece.rect.centre.y)).toBeLessThan(1);
      }
    },
    SCENE_TIMEOUT_MS,
  );

  it(
    'keeps a real centre hole, where the bed shows through, as a hole',
    () => {
      const bed = darkBed();
      const blanks = [
        { x: 70, y: 110 },
        { x: 200, y: 110 },
      ].map((c) => [
        disc(c.x, c.y, 4, bed),
        {
          kind: 'rect',
          centre: c,
          length: 100,
          width: 100,
          angleDeg: 0,
          colour: PLYWOOD,
        } as RenderedPiece,
      ]);
      const pieces = find(blanks.flat(), darkBed);
      expect(pieces).toHaveLength(2);
      expect(pieces.map((piece) => piece.holes?.length)).toEqual([1, 1]);
    },
    SCENE_TIMEOUT_MS,
  );
});
