// G-code Inspector render model types (ADR-255 stage 2). The render model is
// the pure typed-array representation of a parsed program that the 3D viewer,
// timeline, source pane, and Program Health report all consume.

/** Geometric segment classification for the palette and per-kind totals. */
export const SEG_KIND = {
  travel: 0,
  cut: 1,
  plunge: 2,
  retract: 3,
} as const;
export type SegKindName = keyof typeof SEG_KIND;

/** The modal motion word the segment was emitted under. */
export const SEG_MOTION = {
  rapid: 0,
  linear: 1,
  cw: 2,
  ccw: 3,
} as const;

/**
 * Total-line-accountability categories (ADR-255 acceptance gate 1): every raw
 * line of the input classifies into exactly one of these.
 */
export const LINE_CATEGORY = {
  blank: 0,
  comment: 1,
  marker: 2,
  motion: 3,
  modalOnly: 4,
  event: 5,
  unsupported: 6,
  junk: 7,
  afterEnd: 8,
} as const;
export type LineCategoryName = keyof typeof LINE_CATEGORY;

/** Non-motion happenings surfaced on the timeline and in the source pane.
 * `line` is the zero-based raw line index. */
export type ProgramEvent =
  | { readonly kind: 'units'; readonly line: number; readonly units: 'mm' | 'inch' }
  | {
      readonly kind: 'spindle-on';
      readonly line: number;
      readonly mode: 'constant' | 'dynamic';
      readonly power: number;
    }
  | { readonly kind: 'spindle-off'; readonly line: number }
  | { readonly kind: 'coolant-on'; readonly line: number; readonly channel: 'mist' | 'flood' }
  | { readonly kind: 'coolant-off'; readonly line: number }
  | { readonly kind: 'dwell'; readonly line: number; readonly seconds: number }
  | { readonly kind: 'pause'; readonly line: number; readonly optional: boolean }
  | { readonly kind: 'program-end'; readonly line: number }
  | { readonly kind: 'wcs-select'; readonly line: number; readonly code: number }
  | { readonly kind: 'canned-cycle'; readonly line: number; readonly code: number }
  | { readonly kind: 'tool-word'; readonly line: number; readonly tool: number }
  | {
      readonly kind: 'home';
      readonly line: number;
      readonly axes: ReadonlyArray<'X' | 'Y' | 'Z'>;
    };

export type UnsupportedWordCount = {
  readonly word: string;
  readonly count: number;
  /** Zero-based raw line index of the first occurrence. */
  readonly firstLine: number;
};

/** A motion line the model could not turn into geometry (bad arc, non-finite
 * target). Rendered programs stay partial rather than failing (ADR-255 §5). */
export type SkippedMotion = {
  readonly line: number;
  readonly reason: string;
};

export type AxisBounds = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
};

export type ProgramStats = {
  /** Bounds over every emitted segment (travel included); null when no motion. */
  readonly motionBounds: AxisBounds | null;
  /** Bounds over cut/plunge segments only; null when the program never cuts. */
  readonly cutBounds: AxisBounds | null;
  readonly travelMm: number;
  readonly cutMm: number;
  readonly plungeMm: number;
  readonly retractMm: number;
  /** Modal feed range over non-rapid segments; null when F never appeared. */
  readonly feedMinMmPerMin: number | null;
  readonly feedMaxMmPerMin: number | null;
  /** Modal S range over non-rapid segments; null when S never appeared. */
  readonly powerMin: number | null;
  readonly powerMax: number | null;
  /** Distinct plunge target Z levels, deepest last, rounded to 1 µm. */
  readonly zLevels: ReadonlyArray<number>;
};

export type GcodeRenderModel = {
  readonly segmentCount: number;
  /** Six floats per segment: x0 y0 z0 x1 y1 z1, work coordinates, mm. */
  readonly positions: Float32Array;
  /** SEG_KIND value per segment. */
  readonly segKind: Uint8Array;
  /** SEG_MOTION value per segment. */
  readonly segMotion: Uint8Array;
  /** Zero-based raw source line index per segment. */
  readonly segLine: Uint32Array;
  /** Modal F (mm/min) in force when the segment was emitted; 0 = never set. */
  readonly segFeed: Float32Array;
  /** Modal S in force when the segment was emitted. */
  readonly segPower: Float32Array;
  /** Cumulative route mm at each segment's end (arc-true, not chord-sum). */
  readonly segRouteEndMm: Float32Array;
  readonly totalRouteMm: number;
  readonly lineCount: number;
  /** LINE_CATEGORY value per raw line — the accountability array. */
  readonly lineCategories: Uint8Array;
  readonly events: ReadonlyArray<ProgramEvent>;
  readonly unsupportedWords: ReadonlyArray<UnsupportedWordCount>;
  readonly skippedMotions: ReadonlyArray<SkippedMotion>;
  readonly stats: ProgramStats;
};

export type BuildRenderModelOptions = {
  /** Line cap for the synchronous path; the Stage-11 worker path raises it. */
  readonly maxLines?: number;
};

export type BuildRenderModelResult =
  | { readonly kind: 'ok'; readonly model: GcodeRenderModel }
  | { readonly kind: 'error'; readonly reason: string };
