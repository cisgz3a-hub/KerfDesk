import type { Cnc2dStockEvidence } from '../cnc/cnc-pocket-stock';
import type { CncTaperedInlaySettings } from '../scene/cnc-tapered-inlay';
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

import type { CncCompilationSidecar } from './cnc-compilation-sidecar-types';
export type { CncCompilationSidecar } from './cnc-compilation-sidecar-types';
import type { CutArcMoves, LeadContour } from './cut-segment-geometry';
export type { CutArcMoves } from './cut-segment-geometry';
import type { RotaryTaperProfile } from './rotary-taper-profile';

import { representedCncCoordinateMm } from '../cnc/coordinate-representation';
import { sampleCircularArcPoints } from '../geometry/arc-representation';
import type { RasterPowerValues } from '../raster/raster-power-values';
import type { CncCuttingStage } from '../scene/cnc-stage-recipe';
import {
  assertNever,
  type Bounds,
  type CncCoolantMode,
  type CncCutType,
  type CncToolKind,
  type LayerFillStyle,
  type LayerOperationSettings,
  type Vec2,
} from '../scene';
import { cncHelicalContourPoints } from './cnc-helical-representation';
import type { CncFeedSource } from '../scene/cnc-feed-source';
import type { Vec3 } from '../geometry/vec3';
import type { IslandFillMotionPolicy } from './island-fill-motion';
import type { FillRunwayPolicy } from './fill-runway-policy';
import type { EffectiveScanDirection } from './scan-direction-policy';
import type { CutGroupLaserLeads } from './laser-lead-settings';
import type { KerfSideAssumedDiagnostic } from './kerf-scene-sides';

export type CutSegment = {
  /** Timing-only CNC projection already uses the CNC emitter's coordinate
   * representation; laser decimal-collapse filtering must not reinterpret it. */
  readonly plannerCoordinatesRepresented?: true;
  // Polyline in mm, in machine coordinates (post-origin-transform). For a
  // closed segment, the last point equals the first by construction.
  readonly polyline: ReadonlyArray<Vec2>;
  readonly closed: boolean;
  /** Source-path nesting (ADR-531), or surviving compiled run nesting when a
   * topologyContour is present (ADR-486 Amd 2). From the path's carried
   *  forest (ADR-531): `depth` among the contours sharing `forest`, a key
   *  unique to one path of one object. Inside-first ordering reads it instead
   *  of probing those contours; absent, it probes as before. */
  readonly nesting?: {
    readonly forest: string;
    readonly depth: number;
    /** New compiled operation/run contour identity. Absent on historical Jobs. Plain archive data. */
    readonly topologyContour?: string;
  };
  /** Estimator-only 3D edge geometry for a two-point CNC segment. */
  readonly plannerMotion?: {
    readonly distanceMm: number;
    readonly direction: Vec3;
  };
  /** ADR-432: the same burn as native line/arc moves. Laser line cuts only,
   * on arc-capable machines; read it through validCutArcMoves. */
  readonly arcMoves?: CutArcMoves;
  /** ADR-626: the burn the final pass runs instead of `polyline`, present only
   * on a contour that has leads and an overcut: the overcut runs past the start
   * and the lead-out leaves from where it ends. Read it through
   * finalPassCutSegments; bounds, coordinate checks and the rotary mapping read
   * it too. Written as chords, as an overcut final pass always is (ADR-415). */
  readonly finalPassBurn?: { readonly polyline: ReadonlyArray<Vec2> };
  /** ADR-626 Amd 1: the scene contour a closed Line contour was cut from
   * (laserLeadSourceKey), so leads judge its scrap side among the whole
   * scene's contours. Compile writes it only when some operation asks for
   * leads; preparation drops it once leads are placed. */
  readonly leadSource?: string;
  readonly leadContour?: LeadContour;
};

export type FillSegment = CutSegment & {
  readonly reverse: boolean;
};

export type CutGroup = {
  readonly focusTest?: { readonly offsetMm: number; readonly travelFeedMmPerMin: number };
  /** New topology packet scope. Historical groups without it retain legacy optimization/replay. */
  readonly topologyScope?: string;
  readonly kind: 'cut';
  /** Timing-only CNC projection: an emitted spindle/tool transition drains
   * preceding motion before this group's first move. */
  readonly plannerStopBefore?: true;
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
  // ADR-239: tangential laser-off G1 runways (mm) at burn feed on the 4040-safe
  // profile: an entry before each contour and (Amendment 2) an exit after it
  // where the group burns with M3. Absent elsewhere, so bytes stay identical.
  // Follow Shape fill carries both via the Omit below; scanline/island never do.
  readonly entryRunwayMm?: number;
  readonly exitRunwayMm?: number;
  // ADR-415: how far each closed segment runs past its start on the final
  // pass (see cut-pass-segments.ts). Absent when the operation has no overcut
  // or no closed segments, so existing output stays byte-identical. Offset
  // fill groups drop it via the Omit below; overcut is a Line setting.
  readonly finalPassOvercutMm?: number;
  // ADR-494: present only on the group that burns a Line operation's tab
  // spans, which follows that operation's cut group; the share of the cut's
  // power it runs at (`power` already includes it). Absent on every other
  // group, so their output is unchanged.
  readonly tabSpanPowerPercent?: number;
  // ADR-626: present only on a Line operation's cut group whose operation
  // asks for a lead-in or lead-out. Compile records it; preparation adds the
  // leads once the planner has chosen where each closed contour starts
  // (apply-laser-leads.ts). Absent everywhere else, so output is unchanged.
  readonly laserLeads?: CutGroupLaserLeads;
  // ADR-626: the whole outline of each of this group's contours that tabs or
  // perforation cut into pieces, for laser leads to read. Preparation drops it
  // once leads are placed, so a prepared job never carries it.
  readonly topologyRings?: ReadonlyArray<CutTopologyRing>;
  readonly segments: ReadonlyArray<CutSegment>;
};

/** A contour cut in pieces, whole (ADR-626): `forest` and `contour` match the
 * pieces' nesting. */
export type CutTopologyRing = {
  readonly forest: string;
  readonly contour: string;
  readonly polyline: ReadonlyArray<Vec2>;
  /** As on CutSegment (ADR-626 Amd 1). */
  readonly leadSource?: string;
};

export type FillGroup = Omit<
  CutGroup,
  | 'kind'
  | 'segments'
  | 'finalPassOvercutMm'
  | 'tabSpanPowerPercent'
  | 'laserLeads'
  | 'topologyRings'
> & {
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
  // ADR-492: present only for an image scanned at an angle, in (0, 180). Then
  // `bounds`, the pixel grid, rows, overscan and scan offset are all in the
  // scan frame, which reaches machine coordinates by rotating this many
  // degrees counter-clockwise about the machine origin (raster-scan-frame.ts).
  // Absent means along machine X, exactly as before.
  readonly scanAngleDeg?: number;
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
  // Provenance marker: the layer asked for a ramp entry, but this path (for
  // relief roughing, the chain's first loop) is too short to ramp along, so the
  // pass keeps its straight plunge (ADR-471, ADR-424 Amendment 1). G-code
  // comments and Job Review disclose it; motion is unchanged.
  readonly entryPlunge?: true;
  // No descending 0.001 mm step fits the requested angle on this path's
  // represented segments. Omission keeps the existing short-path reason.
  readonly entryPlungeReason?: 'coordinate-precision';
  // Provenance marker: the layer asked for a profile lead (ADR-250), but every
  // lead would cut into a part the job keeps, so the pass keeps its straight
  // plunge on the cut line (ADR-250 Amendment 3). Job Review discloses it;
  // motion is unchanged.
  readonly leadBlocked?: true;
  // ADR-491: a stay-down link fed the bit here at this depth, so the pass needs
  // no entry of its own (ramp entry leaves it alone).
  readonly stayDownEntry?: true;
  // ADR-489: earlier passes of this job have cut away everything the cutter
  // would touch at or above this Z anywhere along this pass's path, so the
  // emitter may rapid down to it plus CNC_AIR_RAPID_CLEARANCE_MM before the
  // plunge instead of feeding down from safe Z. Absent: plunge from safe Z.
  readonly airFloorZMm?: number;
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
  // A tabbed entry can retain its original path and plunge when the requested
  // ramp has no descending step at the coordinate precision.
  readonly entryPlunge?: true;
  readonly entryPlungeReason?: 'coordinate-precision';
  // A tabbed profile ring that no lead fits beside (see CncContourPass.leadBlocked).
  readonly leadBlocked?: true;
  // ADR-491: a short level move between two pocket passes, fed at the plunge
  // feed in place of a lift and re-plunge. Provenance only.
  readonly stayDownLink?: true;
  // ADR-489: see CncContourPass.airFloorZMm.
  readonly airFloorZMm?: number;
  // ADR-421 Amendment 2: a level the finishing bit cuts where relief roughing
  // did not reach, ahead of its finishing rows. Provenance only.
  readonly reliefStepDown?: true;
};

export type CncArcPass = {
  readonly kind: 'arc';
  readonly start: Vec2;
  readonly end: Vec2;
  readonly center: Vec2;
  readonly clockwise: boolean;
  readonly zMm: number;
  readonly closed: boolean;
  // ADR-489: see CncContourPass.airFloorZMm.
  readonly airFloorZMm?: number;
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
      return cncHelicalContourPoints(pass);
    default:
      return assertNever(pass, 'CncPass');
  }
}

// Controller-represented depth the plunge move enters at — contour passes
// plunge to their single Z; path3d passes plunge to their first vertex's Z.
export function cncPassEntryDepthMm(pass: CncPass): number {
  switch (pass.kind) {
    case 'contour':
      return representedCncCoordinateMm(pass.zMm);
    case 'path3d':
      return representedCncCoordinateMm(pass.points[0]?.z ?? 0);
    case 'arc':
      return representedCncCoordinateMm(pass.zMm);
    case 'helical-contour':
      return representedCncCoordinateMm(pass.startZMm);
    default:
      return assertNever(pass, 'CncPass');
  }
}

export type CncGroup = {
  readonly restStock?: Cnc2dStockEvidence;
  /** Explicit independent recipe used for this compiled stage. */
  readonly cuttingStage?: CncCuttingStage;
  readonly pairedInlay?: {
    readonly kind: 'tapered-v';
    readonly piece: 'pocket' | 'plug';
    readonly pairId: string;
    readonly settings: CncTaperedInlaySettings;
  };
  readonly kind: 'cnc';
  readonly layerId: string;
  readonly sourceObjectId?: string;
  readonly color: string;
  readonly cutType: CncCutType;
  // Multi-tool jobs (H.7): which bit cuts this group. Optional — absent means the machine's
  // single active bit (pre-H.7 jobs, test fixtures); the emitter only inserts M0 tool-change
  // blocks when a job actually switches between distinct bits.
  readonly toolId?: string;
  readonly toolName?: string;
  readonly toolDiameterMm: number;
  // Incident provenance copied from the exact compiled settings. Optional so
  // legacy archives and hand-built Job fixtures remain readable.
  readonly toolKind?: CncToolKind;
  readonly toolTipAngleDeg?: number;
  readonly toolTipDiameterMm?: number;
  readonly toolFluteCount?: number;
  // Current primary cutter for the layer that owns the shared feed/plunge/RPM/depth-per-pass
  // settings. This differs from toolId for secondary clearing/finishing groups. It describes the
  // current sharing relationship, not which cutter historically produced a numeric value.
  readonly layerPrimaryToolId?: string;
  readonly requestedDepthMm?: number;
  readonly registrationHoleDiameterMm?: number;
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
  // ADR-491: lift height before the park move. Absent = safe Z.
  readonly parkZMm?: number;
  readonly designBounds?: Bounds; // ADR-327 Amd 1: the Job Origin anchor, not the reach
  readonly passes: ReadonlyArray<CncPass>;
};

export type Group = CutGroup | FillGroup | RasterGroup | CncGroup;

// Something the compile path noticed that the operator should know about, but
// which must never refuse the job (rule 7). Surfaced in the Job Review warnings
// list. Optional on Job so every existing Job literal stays valid.
export type JobDiagnostic =
  | {
      readonly kind: 'fill-ownership-failed';
      readonly layerId: string;
      readonly layerName: string;
      readonly runScope: string;
      readonly objectIds: ReadonlyArray<string>;
      readonly count: number;
    }
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
  // ADR-486 amendment 1: the kerf offset succeeded but closed up `count` holes
  // or slots narrower than twice the offset (parts, when the offset is
  // negative), so they are missing from the cut.
  | {
      readonly kind: 'kerf-offset-closed-up';
      readonly layerName: string;
      readonly count: number;
      readonly kerfOffsetMm: number;
    }
  // ADR-486 amendment 3: a closed shape taken for a score line or border.
  | KerfSideAssumedDiagnostic
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
    }
  // ADR-492: the operation asks for a scan angle, cross-hatch or an angle change
  // per pass, but a rotary only keeps rows along X straight, so every pass
  // scans along X.
  | {
      readonly kind: 'image-scan-angle-rotary';
      readonly layerName: string;
      readonly source: string;
    }
  // ADR-626: the operation asks for leads, but some contours get none or a
  // shorter one. `count` perforated contours have no closed outline left to
  // lead into, and `count` tabbed contours start and stop at their tabs
  // instead. `layerId` tells operations that share a name apart; `layerName`
  // is shown.
  | {
      readonly kind: 'laser-leads-perforated';
      readonly layerId: string;
      readonly layerName: string;
      readonly count: number;
    }
  | {
      readonly kind: 'laser-leads-tabbed';
      readonly layerId: string;
      readonly layerName: string;
      readonly count: number;
    }
  // `shortened` leads were cut down and `omitted` left out because the full
  // lead would leave the scrap side, come too close to another cut line or
  // leave the bed.
  | {
      readonly kind: 'laser-leads-adjusted';
      readonly layerId: string;
      readonly layerName: string;
      readonly shortened: number;
      readonly omitted: number;
    }
  // ADR-626 Amd 1: with Lead side automatic, `count` contours got no leads
  // because a closed shape on an operation without leads (`aroundName`) holds
  // them, and it may be a part or only a score line or border. Amd 8: or
  // because open lines of `aroundName` close a region round them.
  | {
      readonly kind: 'laser-leads-side-unknown';
      readonly layerId: string;
      readonly layerName: string;
      readonly count: number;
      readonly aroundName: string;
      /** Open lines of `aroundName` close a region round them, rather than a
       * closed shape holding them (ADR-626 Amd 8). */
      readonly aroundOpenPaths?: true;
    };

/** Complete compile evidence for one scheduled V-carve operation. */
export type CncVCarveCompilationEvidence = {
  // Finite source-boundary witnesses, independent of the sampled medial graph.
  // This describes the full finish before clearing-stock pruning, not a
  // whole-region accuracy bound. Pruning adds bounded emitted-grid XY rounding
  // at split endpoints and independently rechecks source containment.
  readonly sourceBoundaryCoverage?: {
    readonly maxSampledResidualMm: number | null;
    readonly sampleCount: number;
    readonly samplingComplete: boolean;
  };
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

// The relief planning evidence lives beside the job (job.ts holds the raw
// line backstop); re-exported so every reader keeps importing it from here.
export type { CncReliefPlanningEvidence } from './cnc-relief-planning-evidence';

export type Job = {
  readonly groups: ReadonlyArray<Group>;
  /** Physical contour-entry limits in these exact program coordinates. Null
   * omits optional entries; absent preserves pre-envelope archived output. */
  readonly contourEntryBounds?: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  } | null;
  readonly diagnostics?: ReadonlyArray<JobDiagnostic>;
  /** The cone a machine-space rotary job was warped onto (ADR-694); absent on
   * every other job. A later stage reads the local Y factor from it. */
  readonly rotaryTaper?: RotaryTaperProfile;
  readonly cncCompilation?: CncCompilationSidecar;
  /** Laser finish placed by preparation (ADR-493). Absent keeps the default. */
  readonly laserFinish?: JobLaserFinish;
  /** Placed job's anchor Y, kept by an active rotary (ADR-127 Amd 1); absent: Y 0. */
  readonly rotaryAnchorY?: number;
};

/** Where a laser job leaves the head (ADR-493): `point` is in this job's program
 * coordinates; `set-aside` is a configured bed finish that could not be placed,
 * so the default applies and Job Review says why. */
export type JobLaserFinish =
  | { readonly kind: 'stay' }
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'set-aside'; readonly reason: 'unplaced' | 'rotary' };

export const EMPTY_JOB: Job = { groups: [] };
