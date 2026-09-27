// Where the selected design goes on each found piece (ADR-442). When the
// design already sits on one piece, that piece is the sample: every other
// piece gets a copy moved by the offset between the pieces' centres and
// turned by the angle between them, so the design lands on each blank the way
// it sits on the sample. Otherwise the design is centred on each piece, its
// own long side along the piece's long side, counting any turn the design
// already has (amendment 1). Moves and turns only, never a scale. Pure core.

import { pointInPolygon } from '../../geometry';
import type { ArrayPlacement } from '../../scene';
import type { DetectedPiece } from './find-pieces';
import type { Point } from './rotated-rect';

export type DesignFrame = {
  /** Centre of the design's box, bed mm. */
  readonly centre: Point;
  /** The box's sides along and across the design's own frame. */
  readonly width: number;
  readonly height: number;
  /** How far the design's frame is already turned from the page, degrees. */
  readonly turnDeg: number;
};

/** The first piece whose outline contains `point`, or null. */
export function pieceUnder(
  pieces: ReadonlyArray<DetectedPiece>,
  point: Point,
): DetectedPiece | null {
  return pieces.find((piece) => pointInPolygon(point, piece.outline)) ?? null;
}

/**
 * Degrees that turn `from` to lie like `to`, y down. The long sides are
 * matched, which fixes the turn up to a quarter turn for square pieces and a
 * half turn for oblong ones; when both pieces lean one way (a heading), the
 * heading picks among those, otherwise the smallest turn is taken. Round
 * pieces turn by their headings alone, or not at all.
 */
export function relativeRotationDeg(from: DetectedPiece, to: DetectedPiece): number {
  const headingTurn =
    from.headingDeg !== null && to.headingDeg !== null
      ? wrapped(to.headingDeg - from.headingDeg, 360)
      : null;
  if (from.shape === 'round' && to.shape === 'round') return headingTurn ?? 0;
  const period = from.shape !== 'oblong' && to.shape !== 'oblong' ? 90 : 180;
  const axisTurn = wrapped(to.rect.axisDeg - from.rect.axisDeg, period);
  if (headingTurn === null) return axisTurn;
  // The sides give the angle precisely; the heading only says which side leads.
  const periods = Math.round((headingTurn - axisTurn) / period);
  return wrapped(axisTurn + periods * period, 360);
}

/**
 * One placement per piece, in the order given. Placement 0 applies to the
 * design itself, so when the sample is among `pieces` it comes first and
 * leaves the design where it is.
 */
export function piecePlacements(args: {
  readonly pieces: ReadonlyArray<DetectedPiece>;
  readonly design: DesignFrame;
  readonly sample: DetectedPiece | null;
}): ArrayPlacement[] {
  const { design, sample } = args;
  const ordered = [
    ...args.pieces.filter((piece) => piece === sample),
    ...args.pieces.filter((piece) => piece !== sample),
  ];
  return ordered.map((piece) => placementOn(piece, design, sample));
}

/** How the design moves and turns to land on `piece`. */
export function placementOn(
  piece: DetectedPiece,
  design: DesignFrame,
  sample: DetectedPiece | null,
): ArrayPlacement {
  if (sample === null) {
    return placement(
      piece.rect.centre.x - design.centre.x,
      piece.rect.centre.y - design.centre.y,
      alignedRotationDeg(piece, design),
      piece.rect.centre,
    );
  }
  return placement(
    piece.rect.centre.x - sample.rect.centre.x,
    piece.rect.centre.y - sample.rect.centre.y,
    piece === sample ? 0 : relativeRotationDeg(sample, piece),
    piece.rect.centre,
  );
}

function alignedRotationDeg(piece: DetectedPiece, design: DesignFrame): number {
  if (piece.shape === 'round') return 0;
  if (piece.shape === 'square') return wrapped(piece.rect.axisDeg - design.turnDeg, 90);
  const designAxisDeg = design.turnDeg + (design.width >= design.height ? 0 : 90);
  return wrapped(piece.rect.axisDeg - designAxisDeg, 180);
}

function placement(dx: number, dy: number, rotationDeg: number, pivot: Point): ArrayPlacement {
  return rotationDeg === 0
    ? { dx, dy, rotationDeg: 0 }
    : { dx, dy, rotationDeg, pivot: { x: pivot.x, y: pivot.y } };
}

/** `deg` folded into (-period / 2, period / 2]. */
function wrapped(deg: number, period: number): number {
  let folded = deg % period;
  if (folded > period / 2) folded -= period;
  if (folded <= -period / 2) folded += period;
  return folded === 0 ? 0 : folded;
}
