export type LaserSecondPassPoint = { readonly x: number; readonly y: number };

export type LaserSecondPassBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type LaserSecondPassStroke = {
  readonly id: string;
  readonly mode: 'paint' | 'erase';
  readonly radiusMm: number;
  /** Multiplies each original S value; 1 retains the original tonal power. */
  readonly powerScale: number;
  readonly points: ReadonlyArray<LaserSecondPassPoint>;
};

export type LaserSecondPassSelection = {
  readonly version: 1;
  readonly maxPowerS: number;
  readonly strokes: ReadonlyArray<LaserSecondPassStroke>;
  /** Original work coordinates in mm, needed if the source starts relatively. */
  readonly initialPosition?: LaserSecondPassPoint;
};

/**
 * The painted-pass writer that produced a program, recorded with each saved
 * stage so it replays byte-identically (ADR-341 Amendment 3).
 *
 * 1: replays every selected sweep end to end and writes G1 and S on every line.
 * 2: replays each selected sweep only from its painted span less the sweep's
 *    own lead-in to the painted span plus its own lead-out, and leaves out
 *    motion and power words that repeat the modal value.
 */
export type LaserSecondPassWriterVersion = 1 | 2;

export type LaserSecondPassSegment = {
  readonly from: LaserSecondPassPoint;
  readonly to: LaserSecondPassPoint;
  readonly power: number;
  readonly feed: number;
  readonly mode: 3 | 4;
  readonly rapid: boolean;
};

export type LaserSecondPassError = { readonly kind: 'error'; readonly message: string };

export type LaserSecondPassProgramResult =
  | LaserSecondPassError
  | {
      readonly kind: 'ready';
      readonly gcode: string;
      /** Positive-power motion only. */
      readonly bounds: LaserSecondPassBounds;
      /** All emitted sweep motion and known positioning, for the exact Frame. */
      readonly motionBounds: LaserSecondPassBounds;
      readonly burnLengthMm: number;
      readonly clamped: boolean;
    };

export type LaserSecondPassSourceResult =
  | LaserSecondPassError
  | { readonly kind: 'ready'; readonly segments: ReadonlyArray<LaserSecondPassSegment> };
