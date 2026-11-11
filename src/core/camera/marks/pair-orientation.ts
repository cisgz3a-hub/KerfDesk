// Which way round the two found Print and Cut marks are (ADR-443 Amendment 3,
// rolling audit v13 Y3-P2-1). Two marks alone cannot say: the same pair taken
// the other way round fits the targets' spacing just as well, half a turn off.
// matchMarkPair takes the order that lies nearer the design's targets, which
// is right only while the sheet sits within a quarter turn of the design; an
// upside-down sheet with diagonal marks even reads "turned 0°", and the cut
// misses the print by its whole size.
//
// The camera sees the printed sheet itself, so each order is checked against
// it: the design's artwork, carried onto the bed by that order's
// registration, should land on print that stands darker than the paper round
// it. The order whose artwork stands out clearly more wins. When the print cannot tell (no artwork beside the
// marks, or artwork as symmetric as the marks), a turn past where swapping is
// plausible is reported for the operator to confirm. Pure core.

import {
  applySimilarityPoint,
  solveTwoPointRegistration,
} from '../../registration/similarity-transform';
import type { RgbaImage } from '../rgba-image';
import type { Point } from './find-marks';
import type { MarkPair } from './match-mark-pair';

/** A box of the design's printed artwork, design mm. */
export type ArtworkBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type PairOrientation =
  /** The print showed which order: `flipped` when it was not the nearest one. */
  | { readonly kind: 'print'; readonly pair: MarkPair; readonly flipped: boolean }
  /** The print could not tell, and the sheet lies near the design's way up. */
  | { readonly kind: 'nearest'; readonly pair: MarkPair }
  /** The print could not tell, and the sheet is turned far enough that the order may be swapped. */
  | { readonly kind: 'ambiguous'; readonly pair: MarkPair };

/** Past this turn either order is a plausible way to lay the sheet. */
export const AMBIGUOUS_TURN_DEG = 45;
/**
 * Grey levels the artwork must stand darker than the paper round it, and the
 * winning order ahead of the other by as much, for the print to decide.
 */
const DECISIVE_CONTRAST = 15;
/** Sample points across each artwork box, per side. */
const SAMPLES_PER_SIDE = 12;
/** The ring of paper looked at round each box, as a share of its size (at least 3 mm). */
const SURROUND_SHARE = 0.3;
const MIN_SURROUND_MM = 3;

export function orientMarkPair(args: {
  readonly pair: MarkPair;
  readonly targets: readonly [Point, Point];
  readonly artwork: ReadonlyArray<ArtworkBox>;
  /** The camera picture flattened onto the bed. */
  readonly image: RgbaImage;
  readonly region: { readonly x: number; readonly y: number };
  readonly pixelsPerMm: number;
}): PairOrientation {
  const { pair } = args;
  const reversed = reversedPair(pair);
  const asFound = contrastUnder(args, pair);
  const other = contrastUnder(args, reversed);
  if (asFound !== null && other !== null) {
    const best = Math.max(asFound, other);
    if (best >= DECISIVE_CONTRAST && Math.abs(asFound - other) >= DECISIVE_CONTRAST) {
      const flipped = other > asFound;
      return { kind: 'print', pair: flipped ? reversed : pair, flipped };
    }
  }
  return Math.abs(pair.rotationDeg) > AMBIGUOUS_TURN_DEG
    ? { kind: 'ambiguous', pair }
    : { kind: 'nearest', pair };
}

/** The same two marks taken the other way round. */
export function reversedPair(pair: MarkPair): MarkPair {
  return {
    ...pair,
    first: pair.second,
    second: pair.first,
    rotationDeg: wrapped(pair.rotationDeg + 180),
  };
}

// How much darker the design's artwork boxes are than the paper round them,
// carried onto the bed by `pair`'s registration (mean grey of the rings
// minus mean grey of the boxes). Printed artwork stands out from its paper;
// boxes carried half a turn off land on blank paper or the bed, as even as
// what lies round them. Null when no box lands in the picture.
function contrastUnder(args: Parameters<typeof orientMarkPair>[0], pair: MarkPair): number | null {
  const solved = solveTwoPointRegistration({
    design: args.targets,
    machine: [pair.first.centre, pair.second.centre],
  });
  if (!solved.ok) return null;
  const transform = solved.transform;
  const sample = (design: Point): number | null =>
    greyAt(args, applySimilarityPoint(design, transform));
  let boxSum = 0;
  let boxCount = 0;
  let ringSum = 0;
  let ringCount = 0;
  for (const box of args.artwork) {
    for (const grey of boxSamples(box).map(sample)) {
      if (grey === null) continue;
      boxSum += grey;
      boxCount += 1;
    }
    for (const grey of ringSamples(box).map(sample)) {
      if (grey === null) continue;
      ringSum += grey;
      ringCount += 1;
    }
  }
  if (boxCount === 0 || ringCount === 0) return null;
  return ringSum / ringCount - boxSum / boxCount;
}

function boxSamples(box: ArtworkBox): Point[] {
  const points: Point[] = [];
  for (let j = 0; j < SAMPLES_PER_SIDE; j += 1) {
    for (let i = 0; i < SAMPLES_PER_SIDE; i += 1) {
      points.push({
        x: box.minX + ((i + 0.5) / SAMPLES_PER_SIDE) * (box.maxX - box.minX),
        y: box.minY + ((j + 0.5) / SAMPLES_PER_SIDE) * (box.maxY - box.minY),
      });
    }
  }
  return points;
}

// Points on a ring just outside the box, along its four sides.
function ringSamples(box: ArtworkBox): Point[] {
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const margin = Math.max(MIN_SURROUND_MM, SURROUND_SHARE * Math.max(width, height));
  const points: Point[] = [];
  for (let k = 0; k < SAMPLES_PER_SIDE; k += 1) {
    const t = (k + 0.5) / SAMPLES_PER_SIDE;
    const x = box.minX - margin / 2 + t * (width + margin);
    const y = box.minY - margin / 2 + t * (height + margin);
    points.push(
      { x, y: box.minY - margin / 2 },
      { x, y: box.maxY + margin / 2 },
      { x: box.minX - margin / 2, y },
      { x: box.maxX + margin / 2, y },
    );
  }
  return points;
}

function greyAt(
  args: Pick<Parameters<typeof orientMarkPair>[0], 'image' | 'region' | 'pixelsPerMm'>,
  bed: Point,
): number | null {
  const { image } = args;
  const px = Math.floor((bed.x - args.region.x) * args.pixelsPerMm);
  const py = Math.floor((bed.y - args.region.y) * args.pixelsPerMm);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return null;
  const o = (py * image.width + px) * 4;
  if ((image.data[o + 3] ?? 0) === 0) return null;
  return (
    0.299 * (image.data[o] ?? 0) +
    0.587 * (image.data[o + 1] ?? 0) +
    0.114 * (image.data[o + 2] ?? 0)
  );
}

function wrapped(deg: number): number {
  let folded = deg % 360;
  if (folded > 180) folded -= 360;
  if (folded <= -180) folded += 360;
  return folded;
}
