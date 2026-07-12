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

import { sampleCircularArcPoints } from '../geometry/circular-arc';
import {
  assertNever,
  type CncCoolantMode,
  type CncCutType,
  type LayerFillStyle,
  type Vec2,
} from '../scene';
import type { Vec3 } from '../geometry/vec3';
import type { IslandFillMotionPolicy } from './island-fill-motion';

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
  readonly fillStyle?: LayerFillStyle;
  readonly islandMotionPolicy?: IslandFillMotionPolicy;
  readonly overscanMm: number;
  readonly segments: ReadonlyArray<FillSegment>;
};

// F.2 raster group. Carries the pre-dithered S-value buffer plus
// the placement and feed needed by emit-raster.ts to render G-code.
// `sValues.length` MUST equal `pixelWidth * pixelHeight`.
export type RasterGroup = {
  readonly kind: 'raster';
  readonly layerId: string;
  readonly sourceObjectId?: string;
  readonly source?: string;
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
  readonly initialXOffsetMm?: number;
  readonly bidirectionalScanOffsetMm?: number;
  readonly bidirectional?: boolean;
};

// CNC (router/mill) passes. Pre-expanded by core/cnc/compile-cnc-job.ts
// (depth ramping, tab splitting, pocket rings) so the emitter is a dumb, safe
// motion printer: retract to safeZMm → rapid XY → plunge at plungeMmPerMin →
// feed. Pass shapes:
//   - contour: one XY polyline at one constant Z depth (profiles, pockets,
//     engraves, v-carve rings)
//   - path3d:  per-vertex XYZ motion (relief finishing, ramp entries,
//     imported .nc toolpaths)
//   - arc:     one XY circular arc at one constant Z depth (native G2/G3 when
//     valid, sampled G1 fallback where needed)
//   - helical-contour: one or more full G2/G3 circles descending in Z, a
//     level link, then a closed pocket contour at the reached depth
export type CncContourPass = {
  readonly kind: 'contour';
  readonly zMm: number; // cutting depth for this pass; negative below stock top
  readonly polyline: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

export type CncPath3dPass = {
  readonly kind: 'path3d';
  // Machine-coord XY plus Z (0 = stock top, negative into the stock).
  readonly points: ReadonlyArray<Vec3>;
  readonly closed: boolean;
};

export type CncArcPass = {
  readonly kind: 'arc';
  readonly start: Vec2;
  readonly end: Vec2;
  readonly center: Vec2;
  readonly clockwise: boolean;
  readonly zMm: number;
  readonly closed: boolean;
};

export type CncHelicalContourPass = {
  readonly kind: 'helical-contour';
  readonly start: Vec2;
  readonly center: Vec2;
  readonly clockwise: boolean;
  readonly startZMm: number;
  readonly zMm: number;
  readonly revolutions: number;
  readonly polyline: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

export type CncPass = CncContourPass | CncPath3dPass | CncArcPass | CncHelicalContourPass;

// XY projection of a pass — for bounds, origin translation, and the 2D
// preview. Vec3 is structurally assignable to Vec2, so path3d points pass
// through unchanged.
export function cncPassXyPoints(pass: CncPass): ReadonlyArray<Vec2> {
  switch (pass.kind) {
    case 'contour':
      return pass.polyline;
    case 'path3d':
      return pass.points;
    case 'arc':
      return sampleCircularArcPoints(pass);
    case 'helical-contour':
      return [...sampleCircularArcPoints({ ...pass, end: pass.start }), ...pass.polyline];
    default:
      return assertNever(pass, 'CncPass');
  }
}

// Depth the plunge move enters at — contour passes plunge to their single Z;
// path3d passes plunge to their first vertex's Z (used by the estimator).
export function cncPassEntryDepthMm(pass: CncPass): number {
  switch (pass.kind) {
    case 'contour':
      return pass.zMm;
    case 'path3d':
      return pass.points[0]?.z ?? 0;
    case 'arc':
      return pass.zMm;
    case 'helical-contour':
      return pass.startZMm;
    default:
      return assertNever(pass, 'CncPass');
  }
}

export type CncGroup = {
  readonly kind: 'cnc';
  readonly layerId: string;
  readonly color: string;
  readonly cutType: CncCutType;
  // Multi-tool jobs (H.7): which bit cuts this group. Optional — absent
  // means the machine's single active bit (pre-H.7 jobs, test fixtures);
  // the emitter only inserts M0 tool-change blocks when a job actually
  // switches between distinct bits.
  readonly toolId?: string;
  readonly toolName?: string;
  readonly toolDiameterMm: number;
  readonly feedMmPerMin: number; // already capped to device.maxFeed
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number; // S value; capped to machine spindleMaxRpm
  readonly spindleSpinupSec: number; // dwell after spindle start / speed change
  // Machine-wide coolant (a job-level setting copied onto every group). Absent
  // = 'off'; the emitter reads the first group's value once. Optional so 'off'
  // jobs keep byte-identical output and unchanged group shape.
  readonly coolant?: CncCoolantMode;
  readonly safeZMm: number; // retract height for travel between passes
  // H.9 parking parity: postamble/tool-change park position. Absent = the
  // machine origin (pre-H.9 output stays byte-identical).
  readonly parkXMm?: number;
  readonly parkYMm?: number;
  readonly passes: ReadonlyArray<CncPass>;
};

export type Group = CutGroup | FillGroup | RasterGroup | CncGroup;

export type Job = {
  readonly groups: ReadonlyArray<Group>;
};

export const EMPTY_JOB: Job = { groups: [] };
