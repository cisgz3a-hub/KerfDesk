// Job — the intermediate representation that sits between Scene and G-code.
// Scene → Job is the compile step (core/job/compile-job.ts). Job → Plan is the
// optimize step (core/plan, no-op in MVP Phase A). Plan → string is the
// strategy step (core/output, GrblStrategy in Phase A).
//
// Job carries one Group per output-enabled layer. Two kinds (Phase F.2):
//   - CutGroup (kind: 'cut')    — line / fill mode polylines; cut/engrave G-code
//   - RasterGroup (kind: 'raster') — image-mode dithered pixel data; raster G-code
// Consumers that only operate on vectors (optimizer, planner, estimator's
// vector path) filter on kind. The emit strategy dispatches based on kind.

import type { Vec2 } from '../scene';

export type CutSegment = {
  // Polyline in mm, in machine coordinates (post-origin-transform). For a
  // closed segment, the last point equals the first by construction.
  readonly polyline: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

export type FillSegment = CutSegment & {
  readonly reverse: boolean;
};

export type CutGroup = {
  readonly kind: 'cut';
  readonly layerId: string;
  readonly color: string;
  readonly power: number; // 0..100 (percent)
  readonly speed: number; // mm/min; already capped to device.maxFeed
  readonly passes: number; // integer ≥ 1
  readonly airAssist: boolean;
  readonly segments: ReadonlyArray<CutSegment>;
};

export type FillGroup = Omit<CutGroup, 'kind' | 'segments'> & {
  readonly kind: 'fill';
  readonly overscanMm: number;
  readonly segments: ReadonlyArray<FillSegment>;
};

// F.2 raster group. Carries the pre-dithered S-value buffer plus
// the placement and feed needed by emit-raster.ts to render G-code.
// `sValues.length` MUST equal `pixelWidth * pixelHeight`.
export type RasterGroup = {
  readonly kind: 'raster';
  readonly layerId: string;
  readonly color: string;
  readonly power: number; // 0..100 (percent)
  readonly speed: number; // mm/min; already capped to device.maxFeed
  readonly passes: number; // integer â‰¥ 1
  readonly airAssist: boolean;
  // S-values per pixel, already scaled by power %. Row-major.
  readonly sValues: Uint16Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
  // Per ADR-020: 5 mm default overscan margin to keep accel/decel
  // out of the burn area.
  readonly overscanMm: number;
  readonly dotWidthCorrectionMm: number;
};

export type Group = CutGroup | FillGroup | RasterGroup;

export type Job = {
  readonly groups: ReadonlyArray<Group>;
};

export const EMPTY_JOB: Job = { groups: [] };
