/**
 * Work-coordinate offset for GRBL output when the user sets work zero (G10 L20)
 * at the workpiece while the design lives at arbitrary canvas coordinates.
 */

import { type Job } from '../job/Job';
import { type GcodeTemplateContext } from '../plan/GcodeTemplates';

export type GcodeStartMode = 'absolute' | 'current' | 'savedOrigin';
export type GrblLaserPowerMode = 'dynamic-m4' | 'constant-m3';
export type AirAssistCommand = 'M7' | 'M8' | 'none';

export interface GcodeGenerateOptions {
  startMode?: GcodeStartMode;
  savedOrigin?: { x: number; y: number } | null;
  /** Cooperative cancellation checked during G-code emission. */
  signal?: AbortSignal;
  /** Move-level progress for text G-code generation. */
  onProgress?: (event: GcodeOutputProgress) => void;
  /** GRBL $30 — max spindle/PWM (S range). Default 1000. */
  maxSpindle?: number;
  /** GRBL laser power modal command. Default dynamic M4, matching prior output. */
  grblLaserPowerMode?: GrblLaserPowerMode;
  /** Air-assist command to emit for setAir moves. Default M8, matching prior output. */
  airAssistCommand?: AirAssistCommand;
  /**
   * When true, power=0 linear moves are emitted as hard laser-off travel
   * (`M5 S0` -> motion without S) instead of relying on inline `G1 ... S0`.
   * The next positive-power burn re-arms modal laser state immediately before
   * the burn. This protects machines/controllers that visibly mark blank
   * raster gaps even though the G-code requested S0.
   * Defaults to true.
   */
  hardOffZeroPowerLinearMoves?: boolean;
  /**
   * When true, rapid XY moves are emitted through a hard-off boundary:
   * `M5 S0` -> `G0 ...`. The next positive-power burn re-arms modal laser
   * state immediately before the burn. This avoids relying on GRBL $32 laser
   * mode as the only protection against travel burns.
   * Defaults to true.
   */
  hardOffRapidMoves?: boolean;
  /** Machine-space XY to rapid to before M2; omit or null to skip the return move. */
  returnPosition?: { x: number; y: number } | null;
  /** From device profile: lines appended after the standard header (G21/G90/laser off). */
  customStartGcode?: string;
  /** From device profile: lines inserted before laser-off / return / M2 in the footer. */
  customEndGcode?: string;
  /** Full template text for header; if provided this supersedes the built-in header text. */
  gcodeHeaderTemplate?: string;
  /** Full template text for footer; if provided this supersedes the built-in footer text. */
  gcodeFooterTemplate?: string;
  /** Template context values for header/footer substitution. */
  gcodeTemplateContext?: GcodeTemplateContext;
  /**
   * Deterministic clock injection for generated Output metadata and default
   * header date comments. Production omits this and uses wall time.
   */
  clock?: () => string;
}

export interface GcodeOutputProgress {
  fraction: number;
  completedMoves: number;
  totalMoves: number;
  operationIndex: number;
  operationCount: number;
  moveIndex: number;
  moveCount: number;
  emittedLines: number;
  detail?: string;
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
  _savedOrigin: { x: number; y: number } | null | undefined,
): { x: number; y: number } {
  switch (startMode) {
    case 'absolute':
      return { x: 0, y: 0 };
    case 'current':
      return { x: -designBounds.minX, y: -designBounds.minY };
    case 'savedOrigin':
      // Set Origin (UI) sends G10 L20 at click time; WCS zero is the saved
      // physical point. Emit design-local absolute coords (same offset as Head).
      return { x: -designBounds.minX, y: -designBounds.minY };
    default:
      return { x: -designBounds.minX, y: -designBounds.minY };
  }
}
