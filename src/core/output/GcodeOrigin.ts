/**
 * Work-coordinate offset for GRBL output when the user sets work zero (G10 L20)
 * at the workpiece while the design lives at arbitrary canvas coordinates.
 */

import { type Job } from '../job/Job';

export type GcodeStartMode = 'absolute' | 'current' | 'savedOrigin';

export interface GcodeGenerateOptions {
  startMode?: GcodeStartMode;
  savedOrigin?: { x: number; y: number } | null;
  /** Machine-space XY to rapid to before M2; omit or null to skip the return move. */
  returnPosition?: { x: number; y: number } | null;
  /** From device profile: lines appended after the standard header (G21/G90/laser off). */
  customStartGcode?: string;
  /** From device profile: lines inserted before laser-off / return / M2 in the footer. */
  customEndGcode?: string;
}

export function designMinFromJob(job: Job): { minX: number; minY: number } {
  const { minX, minY } = job.bounds;
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { minX: 0, minY: 0 };
  return { minX, minY };
}

/**
 * Offset added to every emitted X/Y: out = canvas + offset.
 */
export function computeGcodeOffset(
  startMode: GcodeStartMode,
  designBounds: { minX: number; minY: number },
  savedOrigin: { x: number; y: number } | null | undefined,
): { x: number; y: number } {
  switch (startMode) {
    case 'absolute':
      return { x: 0, y: 0 };
    case 'current':
      return { x: -designBounds.minX, y: -designBounds.minY };
    case 'savedOrigin': {
      if (!savedOrigin) {
        return { x: -designBounds.minX, y: -designBounds.minY };
      }
      return {
        x: savedOrigin.x - designBounds.minX,
        y: savedOrigin.y - designBounds.minY,
      };
    }
    default:
      return { x: -designBounds.minX, y: -designBounds.minY };
  }
}
