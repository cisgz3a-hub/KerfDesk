// Find pieces on the scenes camera audit v2 (K3) found it failing on
// (ADR-442 Amendment 2): blanks a millimetre or two apart, coasters touching,
// a scorched spoilboard, long shadows, glare on the honeycomb, and offcuts
// whose rectangle's centre lies off the material. Synthetic top-down
// pictures; no camera.

import { describe, expect, it } from 'vitest';
import { findPieces, MIN_PIECE_AREA_MM2, type DetectedPiece } from './find-pieces';
import { offPieceMm, piecesTheDesignFits } from './piece-fit';
import { placementOn, type DesignFrame } from './piece-placements';
import {
  mdfBed,
  onRenderedPiece,
  PLYWOOD,
  renderBedPicture,
  type Colour,
  type RenderedPiece,
} from './piece-render-fixtures';
import type { Point } from './rotated-rect';

const REGION = { x: 0, y: 0, width: 300, height: 220 };
const PPM = 2;
const SCORCH: Colour = [42, 30, 24];
// Each scene renders and searches a whole picture.
const SCENE_TIMEOUT_MS = 60_000;
const greyBed = (): Colour => [120, 120, 122];

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

function find(
  pieces: ReadonlyArray<RenderedPiece>,
  reference: Point | null,
  options: {
    readonly bed?: (x: number, y: number) => Colour;
    readonly light?: (x: number, y: number) => number;
  } = {},
): DetectedPiece[] {
  const image = renderBedPicture({
    region: REGION,
    pixelsPerMm: PPM,
    pieces,
    noise: 2,
    ...options,
  });
  return findPieces({
    image,
    region: REGION,
    pixelsPerMm: PPM,
    reference,
    minAreaMm2: MIN_PIECE_AREA_MM2,
  });
}

function nearest(pieces: ReadonlyArray<DetectedPiece>, at: Point): DetectedPiece | undefined {
  return [...pieces].sort(
    (a, b) =>
      Math.hypot(a.rect.centre.x - at.x, a.rect.centre.y - at.y) -
      Math.hypot(b.rect.centre.x - at.x, b.rect.centre.y - at.y),
  )[0];
}

const BED_CORNER = { x: 4, y: 216 };

describe('blanks close together (K3-P1-1)', () => {
  it(
    'finds blanks 1.5 and 2 mm apart one by one on a flat bed',
    () => {
      const pieces = find(
        [square(40, 50, 50), square(91.5, 50, 50), square(180, 50, 50), square(232, 50, 50)],
        BED_CORNER,
        { bed: greyBed },
      );
      expect(pieces).toHaveLength(4);
      for (const piece of pieces) {
        expect(piece.rect.length).toBeLessThan(51);
        expect(piece.doubt).toBeUndefined();
      }
    },
    SCENE_TIMEOUT_MS,
  );

  it(
    'cuts coasters touching at a point apart',
    () => {
      const discs: RenderedPiece[] = [0, 1, 2].map((k) => ({
        kind: 'disc',
        centre: { x: 50 + k * 60, y: 80 },
        radius: 30,
        colour: PLYWOOD,
      }));
      const pieces = find(discs, BED_CORNER, { bed: mdfBed });
      expect(pieces).toHaveLength(3);
      // The cut takes one pixel line from one side of each touching point.
      pieces.forEach((piece, k) => {
        expect(
          Math.hypot(piece.rect.centre.x - (50 + k * 60), piece.rect.centre.y - 80),
        ).toBeLessThan(1);
      });
    },
    SCENE_TIMEOUT_MS,
  );

  it(
    'doubts two blanks pushed flush together, so they start left out',
    () => {
      const pieces = find(
        [
          square(40, 50, 50),
          square(130, 50, 50),
          square(40, 150, 50),
          square(130, 150, 50),
          square(205, 150, 50),
          square(255, 150, 50),
        ],
        BED_CORNER,
        { bed: mdfBed },
      );
      expect(pieces).toHaveLength(5);
      const pair = nearest(pieces, { x: 230, y: 150 });
      expect(pair?.rect.length).toBeGreaterThan(95);
      expect(pair?.doubt).toBe('larger');
      expect(pieces.filter((piece) => piece.doubt !== undefined)).toHaveLength(1);
    },
    SCENE_TIMEOUT_MS,
  );
});

describe('a scorched spoilboard and long shadows (K3r-P1-1, K3-P2-1)', () => {
  const blanks = [square(50, 50, 60), square(150, 50, 60), square(250, 50, 50)];
  const scorches = [
    [60, 150],
    [100, 150],
    [140, 150],
    [180, 150],
    [220, 150],
    [260, 150],
  ].map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 }));
  const scorched = (x: number, y: number): Colour =>
    scorches.some((s) => Math.abs(x - s.x) <= 9 && Math.abs(y - s.y) <= 9) ? SCORCH : mdfBed(x, y);

  for (const [mode, reference] of [
    ['the design on the bed', BED_CORNER],
    ['no reference', null],
    ['the design on a blank', { x: 150, y: 50 }],
  ] as const) {
    it(
      `finds the blanks and not the scorch marks, with ${mode}`,
      () => {
        const pieces = find(blanks, reference, { bed: scorched });
        expect(pieces).toHaveLength(3);
        for (const piece of pieces) expect(piece.rect.centre.y).toBeLessThan(80);
      },
      SCENE_TIMEOUT_MS,
    );
  }

  it(
    'keeps a blank’s centre where it is beside a long shadow',
    () => {
      // An 8 mm shadow at 0.45 brightness down and to the right of each blank.
      const shadow = (x: number, y: number): Colour => {
        const base = mdfBed(x, y);
        const shaded = blanks.some((b) => onRenderedPiece(b, x - 6.4, y - 4.8));
        return shaded ? [base[0] * 0.45, base[1] * 0.45, base[2] * 0.45] : base;
      };
      const pieces = find(blanks, BED_CORNER, { bed: shadow });
      expect(pieces).toHaveLength(3);
      for (const blank of blanks) {
        if (blank.kind !== 'rect') continue;
        const piece = nearest(pieces, blank.centre);
        expect(
          Math.hypot(
            (piece?.rect.centre.x ?? 0) - blank.centre.x,
            (piece?.rect.centre.y ?? 0) - blank.centre.y,
          ),
        ).toBeLessThan(0.5);
        expect(piece?.rect.length).toBeLessThan(blank.length + 1);
      }
    },
    SCENE_TIMEOUT_MS,
  );
});

describe('glare on the honeycomb (K3-P1-3)', () => {
  it(
    'never leaves a reflection ticked as a piece',
    () => {
      const blanks = [
        square(50, 50, 60),
        square(150, 50, 60),
        square(50, 150, 60),
        square(150, 150, 60),
      ];
      const spots = [
        { x: 240, y: 50, peak: 100, sigma: 8 },
        { x: 250, y: 150, peak: 130, sigma: 5 },
        { x: 240, y: 100, peak: 70, sigma: 12 },
      ];
      const light = (x: number, y: number): number =>
        spots.reduce(
          (sum, s) =>
            sum + s.peak * Math.exp(-((x - s.x) ** 2 + (y - s.y) ** 2) / (2 * s.sigma ** 2)),
          0,
        );
      for (const reference of [BED_CORNER, null]) {
        const pieces = find(blanks, reference, { light });
        const ticked = pieces.filter((piece) => piece.doubt === undefined && !piece.partial);
        expect(ticked).toHaveLength(4);
        for (const piece of ticked) expect(piece.rect.centre.x).toBeLessThan(200);
      }
    },
    SCENE_TIMEOUT_MS,
  );
});

describe('offcuts and the fit check (K3-P1-2, K3-P2-2, K3-P3-2)', () => {
  const lOffcut: RenderedPiece = {
    kind: 'polygon',
    points: [
      { x: 20, y: 20 },
      { x: 140, y: 20 },
      { x: 140, y: 60 },
      { x: 60, y: 60 },
      { x: 60, y: 140 },
      { x: 20, y: 140 },
    ],
    colour: PLYWOOD,
  };
  const ring: RenderedPiece = {
    kind: 'ring',
    centre: { x: 220, y: 80 },
    outerRadius: 55,
    innerRadius: 32,
    colour: PLYWOOD,
  };
  const small = square(220, 185, 30);
  const design = (width: number, height: number): DesignFrame => ({
    centre: BED_CORNER,
    width,
    height,
    turnDeg: 0,
  });

  it(
    'puts a centred design on an L-shaped offcut’s material, not in its notch',
    () => {
      const [piece] = find([lOffcut], BED_CORNER);
      expect(piece).toBeDefined();
      if (piece === undefined) return;
      expect(piece.shape).not.toBe('round');
      const frame = design(36, 24);
      expect(offPieceMm(piece, frame, placementOn(piece, frame, null))).toBe(0);
      const target = piece.onMaterial ?? piece.rect.centre;
      expect(onRenderedPiece(lOffcut, target.x, target.y)).toBe(true);
    },
    SCENE_TIMEOUT_MS,
  );

  it(
    'keeps a ring round and refuses a design that cannot fit across it',
    () => {
      const pieces = find([ring, small, lOffcut], BED_CORNER);
      const found = nearest(pieces, ring.kind === 'ring' ? ring.centre : BED_CORNER);
      expect(found?.shape).toBe('round');
      expect(found?.holes?.length).toBe(1);
      const { fitting, runsOff } = piecesTheDesignFits(pieces, design(36, 24), null);
      // The ring is 23 mm across its material and the square 30 mm wide: only the L fits.
      expect(runsOff).toHaveLength(2);
      expect(fitting).toHaveLength(1);
      const target = fitting[0]?.onMaterial ?? fitting[0]?.rect.centre ?? BED_CORNER;
      expect(onRenderedPiece(lOffcut, target.x, target.y)).toBe(true);
    },
    SCENE_TIMEOUT_MS,
  );

  it(
    'measures how far a too-large design runs off a small blank',
    () => {
      const [piece] = find([small], BED_CORNER);
      if (piece === undefined) throw new Error('no piece');
      const frame = design(36, 24);
      expect(offPieceMm(piece, frame, placementOn(piece, frame, null))).toBeCloseTo(3, 0);
    },
    SCENE_TIMEOUT_MS,
  );
});
