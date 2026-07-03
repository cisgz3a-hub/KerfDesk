// Checkerboard auto-detection (ADR-108, v2.b — the piece the beta handed off).
// Finds the printed board's inner-corner grid in a camera frame with no user
// clicks: X-corner response → candidate peaks → lattice growth → sub-pixel
// refinement. Output pairs with checkerboardObjectPoints() to form the
// BoardObservation the calibration session consumes. Pure core: deterministic,
// buffers in / typed values out, no I/O.

import type { Vec2 } from '../scene';
import type { BoardObservation } from './calibrate';
import type { GrayImage } from './corner-subpix';
import { refineCornerSubpixel } from './corner-subpix';
import { type CheckerboardSpec, type GridFailure, groupIntoGrid } from './grid-lattice';
import { findCornerCandidates } from './xcorner';

export type { CheckerboardSpec } from './grid-lattice';

export type CheckerboardFailure = GridFailure | 'no-corners';

export type CheckerboardDetection =
  | { readonly kind: 'ok'; readonly corners: ReadonlyArray<Vec2> }
  | { readonly kind: 'failed'; readonly reason: CheckerboardFailure };

// Sub-pixel refinement window (half-size, px). Matches the refiner's default;
// named here because the detector owns the refinement pass.
const REFINE_WINDOW = 5;

/**
 * Detect a `spec.rows`×`spec.cols` inner-corner checkerboard in a grayscale
 * frame. Corners return row-major in a deterministic orientation (a 180° flip
 * on symmetric boards is absorbed by the calibration pose). Pair with
 * {@link checkerboardObjectPoints} for the matching board coordinates.
 */
export function detectCheckerboard(img: GrayImage, spec: CheckerboardSpec): CheckerboardDetection {
  const candidates = findCornerCandidates(img);
  if (candidates.length === 0) return { kind: 'failed', reason: 'no-corners' };
  const grid = groupIntoGrid(candidates, spec);
  if (grid.kind === 'failed') return { kind: 'failed', reason: grid.reason };
  const refined = grid.corners.map((c) => refineCornerSubpixel(img, c, REFINE_WINDOW));
  return { kind: 'ok', corners: refined };
}

/**
 * The board-frame coordinates matching {@link detectCheckerboard}'s row-major
 * corner order: (col·spacing, row·spacing) from a top-left origin, in mm of
 * the printed board.
 */
export function checkerboardObjectPoints(spec: CheckerboardSpec, spacingMm: number): Vec2[] {
  const points: Vec2[] = [];
  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.cols; col += 1) {
      points.push({ x: col * spacingMm, y: row * spacingMm });
    }
  }
  return points;
}

/** Convenience: a solved detection as the BoardObservation calibrate() takes. */
export function toBoardObservation(
  detection: Extract<CheckerboardDetection, { readonly kind: 'ok' }>,
  spec: CheckerboardSpec,
  spacingMm: number,
): BoardObservation {
  return {
    objectPoints: checkerboardObjectPoints(spec, spacingMm),
    imagePoints: detection.corners,
  };
}
