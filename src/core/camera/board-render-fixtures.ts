// Synthetic checkerboard IMAGE renderer for the detector harness (ADR-107,
// v2.b). calibrate-fixtures.ts projects ideal corner POINTS; the detector needs
// whole frames, so this renders the pixels a known camera would record of a
// known board pose via the shared plane renderer, colored by the checker
// pattern. Test fixture like calibrate-fixtures: imported only by tests.

import type { Vec2 } from '../scene';
import { projectBoard } from './calibrate-fixtures';
import type { GrayImage } from './corner-subpix';
import { checkerboardObjectPoints } from './detect-checkerboard';
import type { CheckerboardSpec } from './grid-lattice';
import {
  PLANE_BACKGROUND_GRAY,
  type PlaneRenderCamera,
  renderPlaneView,
} from './plane-render-fixtures';

export type BoardRenderOptions = PlaneRenderCamera & {
  readonly spec: CheckerboardSpec;
  readonly spacingMm: number;
};

const BLACK_SQUARE = 25;
const WHITE_SQUARE = 235;
// Quiet-zone margin around the squares, in squares (real prints have one).
const BORDER_SQUARES = 1;

/** Render the frame a camera (K, D) at pose (rvec, tvec) records of the board. */
export function renderCheckerboardView(options: BoardRenderOptions): GrayImage {
  return renderPlaneView(options, (plane) => checkerShade(plane, options.spec, options.spacingMm));
}

/** Ground-truth inner-corner pixel positions for the same render, row-major. */
export function trueCornerPixels(options: BoardRenderOptions): Vec2[] {
  return projectBoard(
    options.k,
    options.d,
    options.rvec,
    options.tvec,
    checkerboardObjectPoints(options.spec, options.spacingMm),
  );
}

function checkerShade(board: Vec2, spec: CheckerboardSpec, spacingMm: number): number {
  const minX = -BORDER_SQUARES * spacingMm - spacingMm;
  const minY = -BORDER_SQUARES * spacingMm - spacingMm;
  const maxX = (spec.cols + BORDER_SQUARES) * spacingMm;
  const maxY = (spec.rows + BORDER_SQUARES) * spacingMm;
  if (board.x < minX || board.x > maxX || board.y < minY || board.y > maxY) {
    return PLANE_BACKGROUND_GRAY;
  }
  // Squares: square (m, n) covers [(m−1)·s, m·s) × [(n−1)·s, n·s); the quiet
  // zone outside the squares but inside the sheet is white.
  const m = Math.floor(board.x / spacingMm) + 1;
  const n = Math.floor(board.y / spacingMm) + 1;
  if (m < 0 || m > spec.cols || n < 0 || n > spec.rows) return WHITE_SQUARE;
  return (m + n) % 2 === 0 ? WHITE_SQUARE : BLACK_SQUARE;
}
