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
import type { RasterPowerValues } from '../raster/raster-power-values';
import {
  assertNever,
  type CncCoolantMode,
  type CncCutType,
  type CncToolKind,
  type LayerFillStyle,
  type LayerOperationSettings,
  type Vec2,
} from '../scene';
import type { CncFeedSource } from '../scene/cnc-feed-source';
import type { Vec3 } from '../geometry/vec3';
import type { IslandFillMotionPolicy } from './island-fill-motion';
import type { FillRunwayPolicy } from './fill-runway-policy';
import type { EffectiveScanDirection } from './scan-direction-policy';

export type CutSegment = {
  // Polyline in mm, in machine coordinates (post-origin-transform). For a
  // closed segment, the last point equals the first by construction.
  readonly polyline: ReadonlyArray<Vec2>;
  readonly closed: boolean;
  /** Estimator-only 3D edge geometry for a two-point CNC segment. */
  readonly plannerMotion?: {
    readonly distanceMm: number;
    readonly direction: Vec3;
  };
};

export type FillSegment = CutSegment & {
  readonly reverse: boolean;
};

export type CutGroup = {
  readonly kind: 'cut';
  readonly layerId: string;
  readonly sourceObjectId?: string;
  readonly color: string;
  readonly power: number; // 0..100 (percent)
  readonly powerMode?: 'constant' | 'dynamic';
  readonly speed: number; // mm/min; already capped to device.maxFeed
  /** Present when compilation capped the requested layer speed. This is
   * operator-facing provenance only; `speed` remains the emitted feed. */
  readonly requestedSpeed?: number;
  /** Exact inherited-plus-object-override settings for an override-derived group. */
  readonly operationSettings?: LayerOperationSettings;
  readonly passes: number; // integer ≥ 1
  readonly airAssist: boolean;
  // ADR-239: length (mm) of the tangential laser-off G1 entry each contour
  // start receives at burn feed on the 4040-safe profile. Absent on profiles
  // that keep legacy contour emission, so their bytes stay identical. Also
  // carried by Follow Shape (offset) FillGroups via the Omit below; scanline
  // and island fill use fillRunwayPolicy sweep plans instead and never set it.
  readonly entryRunwayMm?: number;
  readonly segments: ReadonlyArray<CutSegment>;
};

export type FillGroup = Omit<CutGroup, 'kind' | 'segments'> & {
  readonly kind: 'fill';
  readonly fillStyle?: LayerFillStyle;
  readonly islandMotionPolicy?: IslandFillMotionPolicy;
  readonly fillRunwayPolicy?: FillRunwayPolicy;
  readonly scanDirection?: EffectiveScanDirection;
  readonly bidirectionalScanOffsetMm?: number;
  readonly overscanMm: number;
  readonly segments: ReadonlyArray<FillSegment>;
};

// F.2 raster group. Carries either a pre-dithered S-value buffer or a
// deterministic row provider plus
// the placement and feed needed by emit-raster.ts to render G-code.
// `sValues.length` MUST equal `pixelWidth * pixelHeight`, unless rowProvider
// is present, in which case it may be empty to avoid a full-grid allocation.
export type RasterGroup = {
  readonly kind: 'raster';
  readonly layerId: string;
  readonly sourceObjectId?: string;
  readonly source?: string;
  readonly color: string;
  readonly power: number; // 0..100 (percent)
  readonly speed: number; // mm/min; already capped to device.maxFeed
  /** Present when compilation capped the requested layer speed. */
  readonly requestedSpeed?: number;
  /** Exact inherited-plus-object-override settings for an override-derived group. */
  readonly operationSettings?: LayerOperationSettings;
  readonly passes: number; // integer â‰¥ 1
  readonly airAssist: boolean;
  // S-values per pixel, already scaled by power %. Row-major.
  readonly sValues: RasterPowerValues;
  readonly rowProvider?: (y: number) => RasterPowerValues;
  // Raster storage and streamed error-diffusion providers are consumed from
  // source row 0 upward. A descending physical order maps those source rows
  // onto the job from maxY to minY without reversing storage or rewinding a
  // provider.
  readonly rowProviderOrder?: RasterRowProviderOrder;
  // Execution archives cannot structured-clone a function-valued provider.
  // This marker records that the provider must be deterministically rebuilt
  // from the archived prepared project before any semantic replay.
  readonly archivedRowProviderRecipe?: 'prepared-project';
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
  readonly scanDirection?: EffectiveScanDirection;
};

export type RasterRowProviderOrder = 'ascending-y' | 'descending-y';

// CNC (router/mill) passes. Pre-expanded by core/cnc/compile-cnc-job.ts
// (depth ramping, tab splitting, pocket rings) so the emitter is a dumb, safe
// motion printer: retract to safeZMm → rapid XY → plunge at plungeMmPerMin →
// feed. Pass shapes:
//   - contour: one XY polyline at one constant Z depth (profiles, pockets,
//     engraves, V-carve flat-core clearing routes)
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
  // Most in-cut XYZ moves use the group's cutting feed. Opt-in alternatives,
  // so relief, tabs, imported paths, and existing ramps keep their established
  // feed semantics:
  //   - 'plunge':        every lateral move rides the plunge feed (entry ramps).
  //   - 'z-rate-capped': the cutting feed, reduced per segment only as much as
  //     the descent needs so its Z component stays within the plunge rate. A
  //     variable-depth cutting profile is mostly flat, and riding the plunge
  //     feed across that flat majority costs time for no motion-safety gain.
  readonly lateralFeed?: 'plunge' | 'z-rate-capped';
  // Provenance marker for an actual along-contour entry ramp. Feed selection
  // alone cannot identify one: variable-depth V-carve detail also constrains
  // its descents against the configured plunge rate.
  // Tiling and G-code comments preserve this marker without changing motion.
  readonly entryRamp?: true;
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

/**
 * Sample the exact multi-revolution descent and final contour that the GRBL
 * emitter outputs. The per-vertex Z profile is shared by preview, material
 * removal, and tiling so none can collapse an N-turn helix to one circle.
 */
export function cncHelicalContourPoints(pass: CncHelicalContourPass): ReadonlyArray<Vec3> {
  const circle = sampleCircularArcPoints({ ...pass, end: pass.start });
  const revolutions = Math.max(1, Math.floor(pass.revolutions));
  const points: Vec3[] = [];
  for (let revolution = 0; revolution < revolutions; revolution += 1) {
    for (let index = 0; index < circle.length; index += 1) {
      const point = circle[index];
      if (point === undefined || (revolution > 0 && index === 0)) continue;
      const progress = (revolution + index / Math.max(1, circle.length - 1)) / revolutions;
      points.push({
        x: point.x,
        y: point.y,
        z: pass.startZMm + (pass.zMm - pass.startZMm) * progress,
      });
    }
  }
  points.push(...pass.polyline.map((point) => ({ ...point, z: pass.zMm })));
  return points;
}

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
      return cncHelicalContourPoints(pass);
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
  readonly sourceObjectId?: string;
  readonly color: string;
  readonly cutType: CncCutType;
  // Multi-tool jobs (H.7): which bit cuts this group. Optional — absent
  // means the machine's single active bit (pre-H.7 jobs, test fixtures);
  // the emitter only inserts M0 tool-change blocks when a job actually
  // switches between distinct bits.
  readonly toolId?: string;
  readonly toolName?: string;
  readonly toolDiameterMm: number;
  // Incident provenance copied from the exact compiled settings. Optional so
  // legacy archives and hand-built Job fixtures remain readable.
  readonly toolKind?: CncToolKind;
  readonly toolTipAngleDeg?: number;
  readonly toolTipDiameterMm?: number;
  readonly toolFluteCount?: number;
  // Current primary cutter for the layer that owns the shared
  // feed/plunge/RPM/depth-per-pass settings. This differs from toolId for
  // secondary clearing/finishing groups. It describes the current sharing
  // relationship, not which cutter historically produced a numeric value.
  readonly layerPrimaryToolId?: string;
  readonly requestedDepthMm?: number;
  readonly depthPerPassMm?: number;
  readonly vResolutionMm?: number;
  readonly vCarveFlatDepthEnabled?: boolean;
  readonly rampEntryDeg?: number;
  // Set only on tiled derivatives of a ramped job. Clipping can change the
  // entry geometry, so rampEntryDeg remains requested provenance rather than
  // a final emitted-angle guarantee for that detached tile.
  readonly rampEntryTiled?: true;
  readonly feedSource?: CncFeedSource;
  readonly feedMmPerMin: number; // already capped to device.maxFeed
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number; // S value; capped to machine spindleMaxRpm
  readonly spindleSpinupSec: number; // dwell after spindle start / speed change
  // Machine-wide coolant (a job-level setting copied onto every group). Absent
  // = 'off'; the emitter reads the first group's value once. Optional so 'off'
  // jobs keep byte-identical output and unchanged group shape.
  readonly coolant?: CncCoolantMode;
  readonly safeZMm: number; // retract height for travel between passes
  // ADR-253: when true, the emitter lifts to safe Z and replunges before every
  // pass (profile/engrave line cuts) instead of stepping Z down in place.
  // Resolved from the layer setting at compile. Absent = off (the emitter reads
  // it as false), so pre-ADR-253 groups and non-profile cuts stay byte-identical.
  readonly retractBetweenPasses?: boolean;
  // H.9 parking parity: postamble/tool-change park position. Absent = the
  // machine origin (pre-H.9 output stays byte-identical).
  readonly parkXMm?: number;
  readonly parkYMm?: number;
  readonly passes: ReadonlyArray<CncPass>;
};

/** Deepest positive stock depth reached by the exact compiled pass geometry. */
export function cncGroupMaximumDepthMm(group: CncGroup): number {
  let deepestZ = 0;
  for (const pass of group.passes) {
    switch (pass.kind) {
      case 'contour':
      case 'arc':
        deepestZ = Math.min(deepestZ, pass.zMm);
        break;
      case 'path3d':
        for (const point of pass.points) deepestZ = Math.min(deepestZ, point.z);
        break;
      case 'helical-contour':
        deepestZ = Math.min(deepestZ, pass.startZMm, pass.zMm);
        break;
      default:
        assertNever(pass, 'CncPass');
    }
  }
  return Math.max(0, -deepestZ);
}

export type Group = CutGroup | FillGroup | RasterGroup | CncGroup;

// Something the compile path noticed that the operator should know about, but
// which must never refuse the job (rule 7). Surfaced in the Job Review warnings
// list. Optional on Job so every existing Job literal stays valid.
export type JobDiagnostic =
  | { readonly kind: 'offset-fill-failed'; readonly layerName: string }
  | {
      readonly kind: 'offset-fill-pass-limit';
      readonly layerName: string;
      readonly passLimit: number;
    }
  // Line mode's kerf compensation failed in the geometry engine, so every
  // closed contour on the layer was dropped from the cut. Same silent-loss
  // shape as the offset fill, on the path that cuts the part itself.
  | { readonly kind: 'kerf-offset-failed'; readonly layerName: string }
  // Hatch geometry existed, but every sweep rounded to a stationary point at
  // emitted G-code precision. Keep this advisory so microscopic fill loss is
  // visible without turning it into a Start, Frame, or export refusal.
  | { readonly kind: 'fill-collapsed-at-precision'; readonly layerName: string }
  | {
      readonly kind: 'raster-source-luma-mismatch';
      readonly layerName: string;
      readonly source: string;
      readonly expectedPixels: number;
      readonly actualPixels: number;
    };

/** Complete compile evidence for one scheduled V-carve operation. */
export type CncVCarveCompilationEvidence = {
  readonly operationIndex: number;
  readonly layerId: string;
  readonly entryIssue: string | null;
  readonly offsetFailed: boolean;
  readonly thinResidual: boolean;
  readonly passLimited: boolean;
};

/** Exact nonblocking end-state retained for one bounded CNC planner. */
export type CncOffsetLadderCompilationEvidence = {
  readonly layerId: string;
  readonly kind: 'geometry-failed' | 'pass-limit' | 'relief-pass-limit' | 'thin-detail-dropped';
};

/** Exact positive Stepover consumed by a compiled operation layer. */
export type CncStepoverCompilationEvidence = {
  readonly layerId: string;
  readonly stepoverPercent: number;
};

/** Materialized planning grid and finishing geometry for one relief source. */
export type CncReliefPlanningEvidence = {
  readonly layerId: string;
  readonly source: string;
  readonly stage: 'roughing' | 'finishing';
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellSizeMm: number;
  readonly toolDiameterMm: number;
  readonly toolKind: CncToolKind;
  readonly rowSpacingMm?: number;
  readonly scallopMm?: number;
};

/** Structured-clone-safe CNC evidence retained with the exact compiled Job. */
export type CncCompilationSidecar = {
  readonly vcarveOperations: ReadonlyArray<CncVCarveCompilationEvidence>;
  readonly offsetLadderDiagnostics?: ReadonlyArray<CncOffsetLadderCompilationEvidence>;
  readonly stepoverOperations?: ReadonlyArray<CncStepoverCompilationEvidence>;
  readonly reliefPlans?: ReadonlyArray<CncReliefPlanningEvidence>;
};

export type Job = {
  readonly groups: ReadonlyArray<Group>;
  readonly diagnostics?: ReadonlyArray<JobDiagnostic>;
  readonly cncCompilation?: CncCompilationSidecar;
};

export const EMPTY_JOB: Job = { groups: [] };
