// Test support (ADR-443): a printed sheet with registration marks and some
// artwork, as the pieces' render fixtures draw it. Not shipped code.

import type { RenderedPiece } from '../pieces/piece-render-fixtures';
import { placedPolygon } from '../pieces/piece-render-fixtures';
import type { Point } from './find-marks';

const INK: readonly [number, number, number] = [30, 30, 34];
const PAPER: readonly [number, number, number] = [236, 236, 230];

export type MarkStyle = 'ring' | 'cross' | 'dot';

/** One mark `sizeMm` across, turned by `deg`, drawn before the sheet under it. */
export function printedMark(
  style: MarkStyle,
  centre: Point,
  sizeMm: number,
  deg = 0,
): RenderedPiece[] {
  const r = sizeMm / 2;
  if (style === 'dot') return [{ kind: 'disc', centre, radius: r, colour: INK }];
  if (style === 'ring') {
    return [{ kind: 'ring', centre, outerRadius: r, innerRadius: r * 0.6, colour: INK }];
  }
  const bar = sizeMm * 0.12;
  return [
    { kind: 'rect', centre, length: sizeMm, width: bar, angleDeg: deg, colour: INK },
    { kind: 'rect', centre, length: sizeMm, width: bar, angleDeg: deg + 90, colour: INK },
  ];
}

/** Where the sheet's letter-like ring sits, in sheet coordinates: mark-like, 6 mm across. */
export const ARTWORK_RING_AT = { x: 48, y: 0 } as const;

/**
 * A sheet `width` × `height` mm centred at `centre` and turned by `deg`, with
 * `marks` given in sheet coordinates (origin at the sheet's centre) and a
 * block of artwork in the middle. Marks and artwork are listed first so they
 * are drawn over the paper.
 */
export function printedSheet(args: {
  readonly centre: Point;
  readonly deg: number;
  readonly width: number;
  readonly height: number;
  readonly marks: ReadonlyArray<{
    readonly at: Point;
    readonly style: MarkStyle;
    readonly sizeMm: number;
  }>;
  readonly topMm?: number;
}): {
  readonly pieces: RenderedPiece[];
  readonly markCentres: Point[];
  readonly artworkRingCentre: Point;
} {
  const place = (p: Point): Point => placedPolygon([p], args.centre, args.deg)[0] ?? p;
  const markCentres = args.marks.map((mark) => place(mark.at));
  const marks = args.marks.flatMap((mark, index) =>
    printedMark(mark.style, markCentres[index] ?? mark.at, mark.sizeMm, args.deg),
  );
  const artwork: RenderedPiece[] = [
    // A heavy block, and a small letter-like ring beside it that looks just
    // like a mark: only the spacing tells it apart.
    {
      kind: 'polygon',
      points: placedPolygon(
        [
          { x: -40, y: -25 },
          { x: 40, y: -25 },
          { x: 40, y: 25 },
          { x: -40, y: 25 },
        ],
        args.centre,
        args.deg,
      ),
      colour: INK,
    },
    { kind: 'ring', centre: place(ARTWORK_RING_AT), outerRadius: 3, innerRadius: 1.8, colour: INK },
  ];
  const sheet: RenderedPiece = {
    kind: 'rect',
    centre: args.centre,
    length: Math.max(args.width, args.height),
    width: Math.min(args.width, args.height),
    angleDeg: args.width >= args.height ? args.deg : args.deg + 90,
    colour: PAPER,
  };
  const pieces = [...marks, ...artwork, sheet].map((piece) =>
    args.topMm === undefined ? piece : { ...piece, topMm: args.topMm },
  );
  return { pieces, markCentres, artworkRingCentre: place(ARTWORK_RING_AT) };
}
