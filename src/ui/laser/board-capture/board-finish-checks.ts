// The checks the Place Board panel shows before and after Finish. The PC panel
// renders them; the remote finish_board reads the same findings, so the two
// cannot drift (ADR-654 Amendment 1).

import {
  firstCornerOffsetMm,
  OUTLINE_SCALE_NOTICE_FRACTION,
  type BestFitRectangle,
  type Vec2,
} from '../../../core/scene';
import { MIN_BOARD_DIMENSION_MM } from './constants';

// Above this the captured corners aren't a clean rectangle square to the bed
// (board rotated, or a corner mis-captured), so the drawn axis-aligned outline
// won't match the real board.
const OFF_SQUARE_WARN_MM = 5;
// Above this the FIRST captured corner is too far from the board's bottom-left,
// so the G92 work origin (set at the first corner) sits at the wrong corner —
// the outline looks right but the burn is offset. See ADR-124.
const FIRST_CORNER_WARN_MM = 5;

export type MeasuredRectChecks = {
  /** The corners barely moved; Create board outline is disabled. */
  readonly tooSmall: boolean;
  /** How far the corners are off a rectangle square to the bed, when the PC warns. */
  readonly offSquareMm: number | null;
  /** How far the first corner is from the bottom-left, when the PC warns. */
  readonly firstCornerOffsetMm: number | null;
};

export function measuredRectChecks(
  rect: BestFitRectangle,
  corners: ReadonlyArray<Vec2>,
): MeasuredRectChecks {
  const tooSmall = rect.widthMm < MIN_BOARD_DIMENSION_MM || rect.heightMm < MIN_BOARD_DIMENSION_MM;
  const firstOffset = firstCornerOffsetMm(corners);
  return {
    tooSmall,
    offSquareMm: !tooSmall && rect.offSquareMm > OFF_SQUARE_WARN_MM ? rect.offSquareMm : null,
    firstCornerOffsetMm:
      !tooSmall && firstOffset !== null && firstOffset > FIRST_CORNER_WARN_MM ? firstOffset : null,
  };
}

/** The note shown when the head-measured outline differs from the typed size by over 1 %. */
export function outlineScaleNotice(scale: number): string | null {
  if (Math.abs(scale - 1) <= OUTLINE_SCALE_NOTICE_FRACTION) return null;
  const pct = Math.abs(scale - 1) * 100;
  return `The head measured the board ${pct.toFixed(1)}% ${
    scale > 1 ? 'larger' : 'smaller'
  } than the size you typed. KerfDesk uses the head's measurement.`;
}
