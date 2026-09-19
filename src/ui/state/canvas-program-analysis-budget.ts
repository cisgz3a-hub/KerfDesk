import type { MotionManifest } from '../../core/job/motion-manifest';

// Existing live-countdown budgets also bound optional executable-plan
// analysis. The exact program and its full route remain available above
// these values; only redundant derived representations are omitted.
export const CANVAS_PROGRAM_ANALYSIS_LINE_BUDGET = 25_000;
export const CANVAS_PROGRAM_ANALYSIS_SEGMENT_BUDGET = 25_000;

/** Scan without splitting the complete program into another line array. */
export function canvasProgramExceedsLineBudget(gcode: string): boolean {
  let lines = 1;
  for (let index = 0; index < gcode.length; index += 1) {
    const character = gcode.charCodeAt(index);
    if (character !== 10 && character !== 13) continue;
    if (character === 13 && gcode.charCodeAt(index + 1) === 10) index += 1;
    lines += 1;
    if (lines > CANVAS_PROGRAM_ANALYSIS_LINE_BUDGET) return true;
  }
  return false;
}

/** Reuse the exact manifest's already-expanded geometry before allocating
 * the optional render model, second manifest, parity toolpath and sidecar. */
export function canvasExecutableSidecarWithinBudget(
  gcode: string,
  manifest: MotionManifest,
): boolean {
  if (canvasProgramExceedsLineBudget(gcode)) return false;
  let segments = 0;
  for (const block of manifest.blocks) {
    segments += Math.max(0, block.points.length - 1);
    if (segments > CANVAS_PROGRAM_ANALYSIS_SEGMENT_BUDGET) return false;
  }
  return true;
}
