// vcarvePasses — true V-carving via an inward offset ladder (Phase H.3,
// ADR-098).
//
// For the closed shapes of a layer, successive inward offsets at insets
// d_k = k·δ are cut at z(d) = −min(d / tan(θ/2), maxDepth), where θ is the
// v-bit's included angle. The union of the bit's cone surfaces along
// those rings converges to the true V-groove as δ → 0: the medial axis
// emerges where the offsets vanish, so sharp corners get their full depth
// for free, and clipper's containment-aware offsetting handles holes and
// narrow-channel topology (rings simply stop existing where the region is
// too narrow). Wide regions clamp to maxDepth — those rings flood the flat
// floor at δ spacing (the two-stage clearing-tool variant arrives with
// multi-tool jobs, H.7b).
//
// Because rings vanish wherever the region is narrower than 2δ, artwork
// finer than the ring pitch — thin script strokes, serif tips — would
// otherwise silently drop out of the carve. A second, fine-pitched ladder
// over exactly that uncovered material (vcarve-thin-detail.ts, ADR-279)
// carves those slivers to their shallow centerline groove instead.
//
// Each disconnected filled region is completed shallow → deep (outside-in),
// then its thin-detail rings, before travelling to the next region. Every
// contour keeps its original ladder step. With no entry angle it retains the
// legacy zPassDepths stepped plunges. An explicitly qualified angle instead
// produces continuous multi-lap contour descent plus one full-depth cleanup
// lap. If that requested plan is not representable, Job Review names the
// issue and output retains the legacy stepped entry instead of dropping the
// layer.
//
// Pure and deterministic: source-region order, then k ascending and offset
// engine order within a region (δ rings before detail rings), no clock, no
// random.

import { buildOffsetLadder } from '../geometry/offset-ladder';
import type { CncPass } from '../job';
import type { CncTool, Polyline } from '../scene';
import { zPassDepths } from './depth-passes';
import { hasFinitePoints } from './profile-paths';
import { vcarveIncludedAngleDeg } from './vcarve-angle';
import { planVCarveRampEntry } from './vcarve-entry';
import { vcarveRegionBuckets, type OrderedVCarvePolyline } from './vcarve-region-order';
import { THIN_DETAIL_RESOLUTION_MM, vcarveThinDetailRings } from './vcarve-thin-detail';

const MIN_CLOSED_POINTS = 3;
const MIN_RESOLUTION_MM = 0.1;
const AUTO_RESOLUTION_TOOL_FRACTION = 8;
// Backstop against degenerate inputs (huge region + microscopic δ).
const MAX_VCARVE_RINGS = 8192;

export type VCarveOptions = {
  readonly tool: CncTool;
  readonly maxDepthMm: number;
  readonly depthPerPassMm: number;
  readonly resolutionMm: number; // 0 = auto
  // Opt-in maximum along-contour entry angle. Absent preserves the legacy
  // stepped-plunge program for saved jobs whose cutter entry data is unknown.
  readonly rampAngleDeg?: number;
};

export type VCarveLadder = {
  readonly passes: ReadonlyArray<CncPass>;
  // True when the ring ladder stopped on an offset-engine failure rather than
  // on reaching the medial axis: the carve is shallower and narrower than the
  // artwork asks for. Reported to Job Review, never a refusal (rule 7).
  readonly offsetFailed: boolean;
  // A configured ramp that could not be planned and therefore used the legacy
  // stepped entry. Reported to Job Review, never a refusal (rule 7).
  readonly entryIssue: string | null;
  // True when some artwork is thinner than even the fine detail pitch can
  // carve (< 2 × THIN_DETAIL_RESOLUTION_MM wide): that material stays uncut.
  // Also Job Review material, never a refusal (rule 7).
  readonly thinResidual: boolean;
};

type VCarveRing = {
  readonly polyline: Polyline;
  readonly depthMm: number;
};

export function vcarvePasses(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveOptions,
): ReadonlyArray<CncPass> {
  return vcarveLadderPasses(polylines, options).passes;
}

// Same passes as vcarvePasses, keeping the reason the ladder ended so a carve
// truncated by the offset engine can be reported instead of shipped silently.
export function vcarveLadderPasses(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveOptions,
): VCarveLadder {
  const tipAngleDeg = vcarveIncludedAngleDeg(options.tool);
  if (tipAngleDeg === null) return NO_LADDER;
  const contours = polylines.filter(
    (polyline) =>
      polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline),
  );
  const delta = vcarveResolutionMm(options.resolutionMm, options.tool.diameterMm);
  const tanHalf = Math.tan((tipAngleDeg / 2) * (Math.PI / 180));
  // The bit's cutting flank ends where the cone reaches the full diameter:
  // (D/2)/tan(θ/2). Deeper "V" cuts do not physically exist — the shank
  // would rub and the modeled groove width past the diameter would be a lie
  // (VCarve's flat-depth limit applies the same cap).
  const coneHeightMm =
    Number.isFinite(options.tool.diameterMm) && options.tool.diameterMm > 0
      ? options.tool.diameterMm / 2 / tanHalf
      : Number.POSITIVE_INFINITY;
  const maxDepth = Math.min(options.maxDepthMm, coneHeightMm);
  if (contours.length === 0 || !(maxDepth > 0)) return NO_LADDER;

  // Ring k (1-based in the depth law above) is ladder step k - 1.
  const ladder = buildOffsetLadder(contours, MAX_VCARVE_RINGS, (step) => (step + 1) * delta);
  // A failed ladder's coverage is unknowable — a detail pass against it would
  // re-carve everything at fine pitch. offsetFailed already reports the gap.
  const detail = ladder.offsetFailed
    ? NO_DETAIL
    : vcarveThinDetailRings(contours, ladder.rings[0] ?? [], delta);
  const rings = zipRegionRings(contours, ladder.rings, detail.rings, {
    deltaMm: delta,
    tanHalf,
    maxDepthMm: maxDepth,
  });
  const entry = passesForRings(rings, options.depthPerPassMm, options.rampAngleDeg);
  return {
    ...entry,
    offsetFailed: ladder.offsetFailed || detail.offsetFailed,
    thinResidual: detail.residualThin,
  };
}

const NO_LADDER: VCarveLadder = {
  passes: [],
  offsetFailed: false,
  entryIssue: null,
  thinResidual: false,
};
const NO_DETAIL = { rings: [], offsetFailed: false, residualThin: false } as const;

// Ring spacing: explicit setting wins; 0 = auto at toolDiameter/8 with a
// 0.1 mm floor so tiny engraving bits don't explode the ring count.
export function vcarveResolutionMm(settingMm: number, toolDiameterMm: number): number {
  if (Number.isFinite(settingMm) && settingMm > 0) {
    return Math.max(MIN_RESOLUTION_MM, settingMm);
  }
  return Math.max(MIN_RESOLUTION_MM, toolDiameterMm / AUTO_RESOLUTION_TOOL_FRACTION);
}

// The δ rings and detail rings count steps in different pitches; this maps
// both through the shared depth law, region-zipped so a region finishes its
// rings, then its detail, before the cutter travels on (ADR-270, ADR-279).
type RingDepthClamp = {
  readonly deltaMm: number;
  readonly tanHalf: number;
  readonly maxDepthMm: number;
};

function zipRegionRings(
  contours: ReadonlyArray<Polyline>,
  coarseRings: ReadonlyArray<ReadonlyArray<Polyline>>,
  detailRings: ReadonlyArray<ReadonlyArray<Polyline>>,
  clamp: RingDepthClamp,
): ReadonlyArray<VCarveRing> {
  const coarse = vcarveRegionBuckets(contours, coarseRings);
  const detail = vcarveRegionBuckets(contours, detailRings);
  const rings: VCarveRing[] = [];
  for (let bucket = 0; bucket < Math.max(coarse.length, detail.length); bucket += 1) {
    rings.push(
      ...ringsForBucket(coarse[bucket] ?? [], clamp.deltaMm, clamp),
      ...ringsForBucket(detail[bucket] ?? [], THIN_DETAIL_RESOLUTION_MM, clamp),
    );
  }
  return rings;
}

function ringsForBucket(
  entries: ReadonlyArray<OrderedVCarvePolyline>,
  pitchMm: number,
  clamp: RingDepthClamp,
): ReadonlyArray<VCarveRing> {
  return entries.map(({ step, polyline }) => ({
    polyline,
    depthMm: Math.min(((step + 1) * pitchMm) / clamp.tanHalf, clamp.maxDepthMm),
  }));
}

function passesForRings(
  rings: ReadonlyArray<VCarveRing>,
  depthPerPassMm: number,
  rampAngleDeg: number | undefined,
): Pick<VCarveLadder, 'passes' | 'entryIssue'> {
  const legacyPasses = legacyPassesForRings(rings, depthPerPassMm);
  if (rampAngleDeg === undefined) return { passes: legacyPasses, entryIssue: null };
  const passes: CncPass[] = [];
  for (const ring of rings) {
    const plan = planVCarveRampEntry(ring.polyline, ring.depthMm, depthPerPassMm, rampAngleDeg);
    if (!plan.ok) return { passes: legacyPasses, entryIssue: plan.reason };
    passes.push(...plan.passes);
  }
  return { passes, entryIssue: null };
}

function legacyPassesForRings(
  rings: ReadonlyArray<VCarveRing>,
  depthPerPassMm: number,
): ReadonlyArray<CncPass> {
  return rings.flatMap(({ polyline, depthMm }) =>
    zPassDepths(depthMm, depthPerPassMm).map((zMm) => ({
      kind: 'contour' as const,
      zMm,
      polyline: ringClosure(polyline),
      closed: true,
    })),
  );
}

// Job convention: a closed pass's polyline ends where it starts (the offset
// engine already guarantees this, but a hand-fed polyline may not).
function ringClosure(polyline: Polyline): ReadonlyArray<{ x: number; y: number }> {
  const points = polyline.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  return first.x === last.x && first.y === last.y ? points : [...points, first];
}
