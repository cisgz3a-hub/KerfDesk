// Found pieces that may not be pieces at all (ADR-442 Amendment 2). A broad
// reflection on the bed, a large shadow or mark, or two blanks pushed flush
// together can each pass as a piece; a copy placed on one burns the bed or
// straddles two blanks. Nothing here drops a piece: a doubtful one is shown
// with its reason and starts left out, and the operator can tick it. The
// tests compare a piece with the colour the pieces were found by, and with
// the other pieces' sizes. Pure core.

import type { DetectedPiece } from './find-pieces';
import { colourDistance, quantile, type Colour } from './piece-mask';

export type PieceDoubt = 'colour' | 'smaller' | 'larger';

// A piece whose colour lies further than this share of the bed-to-piece
// step from the pieces' colour does not look like the pieces.
const COLOUR_SHARE = 0.5;
// Hue (chromaticity) differences under this tell nothing: grey on grey.
const MIN_HUE_STEP = 0.02;
// Sizes are judged only when most whole pieces, and at least this many,
// share one size (within this share of the median area): a batch, not a
// deliberate mix of sizes.
const SIZE_PEERS = 3;
const SAME_SIZE_SHARE = 0.25;
const SMALLER_SHARE = 0.3;
const LARGER_SHARE = 1.8;

export function withDoubts(
  pieces: ReadonlyArray<DetectedPiece>,
  bed: Colour | null,
  piece: Colour | null,
): DetectedPiece[] {
  const typicalArea = batchArea(pieces.filter((p) => !p.partial));
  return pieces.map((p) => {
    const doubt = colourDoubt(p, bed, piece) ?? sizeDoubt(p, typicalArea);
    return doubt === null ? p : { ...p, doubt };
  });
}

function colourDoubt(
  p: DetectedPiece,
  bed: Colour | null,
  piece: Colour | null,
): PieceDoubt | null {
  if (p.colour === undefined || bed === null || piece === null) return null;
  const step = colourDistance(piece, bed);
  if (colourDistance(p.colour, piece) > COLOUR_SHARE * step) return 'colour';
  // Glare is the bed's own hue, only brighter: closer in hue to the bed than
  // to the pieces, whatever its brightness.
  const bedHue = hue(bed);
  const pieceHue = hue(piece);
  if (hueDistance(bedHue, pieceHue) < MIN_HUE_STEP) return null;
  const own = hue(p.colour);
  return hueDistance(own, bedHue) < hueDistance(own, pieceHue) ? 'colour' : null;
}

// The batch's area: the median, when most pieces lie near it; else null.
function batchArea(whole: ReadonlyArray<DetectedPiece>): number | null {
  if (whole.length < SIZE_PEERS) return null;
  const median = quantile(
    whole.map((p) => p.areaMm2),
    0.5,
  );
  const alike = whole.filter(
    (p) => Math.abs(p.areaMm2 - median) <= SAME_SIZE_SHARE * median,
  ).length;
  return alike >= SIZE_PEERS && alike * 2 >= whole.length ? median : null;
}

function sizeDoubt(p: DetectedPiece, typicalArea: number | null): PieceDoubt | null {
  if (p.partial || typicalArea === null) return null;
  if (p.areaMm2 < SMALLER_SHARE * typicalArea) return 'smaller';
  return p.areaMm2 > LARGER_SHARE * typicalArea ? 'larger' : null;
}

function hue(colour: Colour): readonly [number, number] {
  const sum = colour[0] + colour[1] + colour[2];
  return sum > 0 ? [colour[0] / sum, colour[1] / sum] : [1 / 3, 1 / 3];
}

function hueDistance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
