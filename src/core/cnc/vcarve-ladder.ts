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
// over exactly that uncovered material (vcarve-thin-detail.ts, ADR-281)
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
import { normalizeClosedPolylinesEvenOddChecked } from '../geometry/polygon-difference';
import type { CncPass } from '../job';
import type { CncTool, Polyline } from '../scene';
import { zPassDepths } from './depth-passes';
import { hasFinitePoints } from './profile-paths';
import { vcarveIncludedAngleDeg } from './vcarve-angle';
import {
  detailPath3dPlan,
  sourceBoundarySegments,
  type BoundarySegment,
  type DetailDepthLaw,
} from './vcarve-detail-depth';
import { orderDetailBySliver } from './vcarve-detail-order';
import { vcarveEffectiveDepthMm } from './vcarve-depth';
import { planVCarveRampEntry } from './vcarve-entry';
import {
  buildVCarveRegionLayout,
  vcarveRegionBucketsWithLayout,
  type OrderedVCarvePolyline,
} from './vcarve-region-order';
import {
  THIN_DETAIL_RESOLUTION_MM,
  vcarveThinDetailRings,
  type ThinDetailRings,
} from './vcarve-thin-detail';

const MIN_CLOSED_POINTS = 3;
const MIN_RESOLUTION_MM = 0.1;
// Two clipper quanta (OFFSET_PRECISION_DECIMALS = 3 → 0.001 mm grid): the
// finest ring pitch whose successive insets stay distinct after rounding.
const MIN_COVERAGE_PITCH_MM = 0.002;
const AUTO_RESOLUTION_TOOL_FRACTION = 8;
// Backstop against degenerate inputs (huge region + microscopic δ).
const MAX_VCARVE_RINGS = 8192;
const THIN_DETAIL_RAMP_FALLBACK =
  'V-carve ramp entry cannot preserve the variable-depth thin-detail profile.';

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
  // True when planning could not represent all requested material/profile at
  // valid settings: a ladder hit its ring budget, the depth-clamp footprint
  // demands a pitch finer than the coverage floor, or XYZ emission precision
  // cannot retain the certified detail-depth tolerance. Reported as the
  // pass-limit advisory, never a refusal (rule 7).
  readonly passLimited: boolean;
};

type VCarveRing = {
  // δ ladder rings keep their pitch depth; detail rings carry the junction
  // blend on the stepped path (per-vertex depths, ADR-281 Amendment 2).
  readonly kind: 'ring' | 'detail';
  readonly polyline: Polyline;
  readonly depthMm: number;
};

// The layer's true boundary, flattened once, plus the depth law — what a
// detail vertex measures its groove against.
type DetailBlend = {
  readonly segments: ReadonlyArray<BoundarySegment>;
  readonly law: DetailDepthLaw;
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
  const requestedDeltaMm = vcarveResolutionMm(options.resolutionMm, options.tool.diameterMm);
  const tanHalf = Math.tan((tipAngleDeg / 2) * (Math.PI / 180));
  const maxDepth = vcarveEffectiveDepthMm(options.tool, options.maxDepthMm);
  if (maxDepth === null || !(maxDepth > 0)) return NO_LADDER;
  const sourceContours = validVCarveContours(polylines);
  // Offsetting a raw self-intersecting contour can invert the intended inset
  // and grow paths outside the artwork. Resolve the layer's even-odd fill into
  // ordinary roots before the coarse ladder, detail coverage, or boundary-depth
  // law is allowed to consume it. Keep the validated source array separately:
  // ADR-270 defines its order as the region-order authority, while Clipper is
  // free to return normalized roots in a different canonical order.
  const normalized = normalizeClosedPolylinesEvenOddChecked(sourceContours);
  if (normalized.kind === 'error') return { ...NO_LADDER, offsetFailed: true };
  const contours = normalized.value;
  if (contours.length === 0) return NO_LADDER;
  // A depth-clamped ring cuts a footprint of only maxDepth·tan(θ/2) radius, so
  // rings spaced wider than twice that leave untouched stripes between them —
  // the defect the #575 revert measured (10.7 % floor coverage at a 0.05 mm
  // max depth). The configured Detail is a MAXIMUM spacing; the clamp physics
  // may demand finer. Same law at the fine pitch. Ring counts stay bounded by
  // MAX_VCARVE_RINGS / MAX_THIN_DETAIL_RINGS as before.
  // One clamp-footprint RADIUS, not diameter: ring-to-ring spacing grows to
  // pitch·√2 across mitered corners (up to 2× at the miter-limit bevel), so
  // rings spaced a full diameter apart leave uncut seams along diagonals —
  // the probe measured 4 % interior stripes at 2·r spacing. r spacing keeps
  // adjacent footprints overlapping in every offset direction.
  const footprintPitchMm = maxDepth * tanHalf;
  // Coverage floor (#584): successive insets must stay distinct on clipper's
  // 1 µm grid, so the pitch never drops below two quanta. A footprint finer
  // than the floor (a 1° bit at 0.05 mm depth: 0.00087 mm) cannot achieve
  // full floor coverage on the emission grid at any ring count — planning is
  // pass-limited and Job Review says so instead of silently capping.
  const delta = Math.max(Math.min(requestedDeltaMm, footprintPitchMm), MIN_COVERAGE_PITCH_MM);
  const finePitchMm = Math.max(
    Math.min(THIN_DETAIL_RESOLUTION_MM, footprintPitchMm),
    MIN_COVERAGE_PITCH_MM,
  );
  const pitchDegraded = footprintPitchMm < MIN_COVERAGE_PITCH_MM;

  // Ring k (1-based in the depth law above) is ladder step k - 1.
  const ladder = buildOffsetLadder(contours, MAX_VCARVE_RINGS, (step) => (step + 1) * delta);
  // A failed ladder's coverage is unknowable — a detail pass against it would
  // re-carve everything at fine pitch. offsetFailed already reports the gap.
  const detail = ladder.offsetFailed
    ? NO_DETAIL
    : vcarveThinDetailRings(contours, ladder.rings[0] ?? [], delta, finePitchMm);
  const rings = zipRegionRings(sourceContours, contours, ladder.rings, detail, {
    deltaMm: delta,
    finePitchMm,
    tanHalf,
    maxDepthMm: maxDepth,
  });
  const blend: DetailBlend = {
    segments: sourceBoundarySegments(contours),
    law: { tanHalf, maxDepthMm: maxDepth },
  };
  const entry = passesForRings(rings, options.depthPerPassMm, options.rampAngleDeg, blend);
  const { detailDepthLimited, ...entryResult } = entry;
  return {
    ...entryResult,
    offsetFailed: ladder.offsetFailed || detail.offsetFailed,
    thinResidual: detail.residualThin,
    passLimited: pitchDegraded || ladder.capped || detail.capped || detailDepthLimited,
  };
}

function validVCarveContours(polylines: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  return polylines.filter(
    (polyline) =>
      polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline),
  );
}

const NO_LADDER: VCarveLadder = {
  passes: [],
  offsetFailed: false,
  entryIssue: null,
  thinResidual: false,
  passLimited: false,
};
const NO_DETAIL = {
  rings: [],
  offsetFailed: false,
  residualThin: false,
  capped: false,
  sliverRoots: [],
} as const;

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
// rings, then its detail, before the cutter travels on (ADR-270, ADR-281).
type RingDepthClamp = {
  readonly deltaMm: number;
  readonly finePitchMm: number;
  readonly tanHalf: number;
  readonly maxDepthMm: number;
};

function zipRegionRings(
  sourceContours: ReadonlyArray<Polyline>,
  normalizedContours: ReadonlyArray<Polyline>,
  coarseRings: ReadonlyArray<ReadonlyArray<Polyline>>,
  detail: ThinDetailRings,
  clamp: RingDepthClamp,
): ReadonlyArray<VCarveRing> {
  const layout = buildVCarveRegionLayout(normalizedContours, sourceContours, [
    ...coarseRings,
    ...detail.rings,
  ]);
  const coarse = vcarveRegionBucketsWithLayout(layout, coarseRings);
  const fine = vcarveRegionBucketsWithLayout(layout, detail.rings);
  const rings: VCarveRing[] = [];
  for (let bucket = 0; bucket < Math.max(coarse.length, fine.length); bucket += 1) {
    rings.push(
      ...ringsForBucket(coarse[bucket] ?? [], clamp.deltaMm, clamp, 'ring'),
      ...ringsForBucket(
        orderDetailBySliver(fine[bucket] ?? [], detail.sliverRoots),
        clamp.finePitchMm,
        clamp,
        'detail',
      ),
    );
  }
  return rings;
}

function ringsForBucket(
  entries: ReadonlyArray<OrderedVCarvePolyline>,
  pitchMm: number,
  clamp: RingDepthClamp,
  kind: VCarveRing['kind'],
): ReadonlyArray<VCarveRing> {
  return entries.map(({ step, polyline }) => ({
    kind,
    polyline,
    depthMm: Math.min(((step + 1) * pitchMm) / clamp.tanHalf, clamp.maxDepthMm),
  }));
}

function passesForRings(
  rings: ReadonlyArray<VCarveRing>,
  depthPerPassMm: number,
  rampAngleDeg: number | undefined,
  blend: DetailBlend,
): Pick<VCarveLadder, 'passes' | 'entryIssue'> & { readonly detailDepthLimited: boolean } {
  const legacy = legacyPassesForRings(rings, depthPerPassMm, blend);
  if (rampAngleDeg === undefined) return { ...legacy, entryIssue: null };
  const firstRing = rings[0];
  if (firstRing === undefined) return { ...legacy, entryIssue: null };
  // Let the canonical planner validate the requested ramp before choosing a
  // detail-specific fallback, so invalid input keeps its exact ADR-278 reason.
  const firstPlan = planVCarveRampEntry(
    firstRing.polyline,
    firstRing.depthMm,
    depthPerPassMm,
    rampAngleDeg,
  );
  if (!firstPlan.ok) return { ...legacy, entryIssue: firstPlan.reason };
  // ADR-278's ramp planner descends to one constant depth per ring. A detail
  // ring instead carries the true boundary depth at every vertex. Replacing
  // that profile with one pitch depth under-cuts its junction, so preserve the
  // complete stepped plan and use ADR-278's existing advisory-only fallback.
  if (rings.some((ring) => ring.kind === 'detail')) {
    return { ...legacy, entryIssue: THIN_DETAIL_RAMP_FALLBACK };
  }
  const passes: CncPass[] = [...firstPlan.passes];
  for (const ring of rings.slice(1)) {
    const plan = planVCarveRampEntry(ring.polyline, ring.depthMm, depthPerPassMm, rampAngleDeg);
    if (!plan.ok) return { ...legacy, entryIssue: plan.reason };
    passes.push(...plan.passes);
  }
  return { passes, entryIssue: null, detailDepthLimited: legacy.detailDepthLimited };
}

function legacyPassesForRings(
  rings: ReadonlyArray<VCarveRing>,
  depthPerPassMm: number,
  blend: DetailBlend,
): { readonly passes: ReadonlyArray<CncPass>; readonly detailDepthLimited: boolean } {
  const passes: CncPass[] = [];
  let detailDepthLimited = false;
  for (const ring of rings) {
    if (ring.kind === 'detail') {
      const detail = detailPassesForRing(ring.polyline, depthPerPassMm, blend);
      passes.push(...detail.passes);
      detailDepthLimited = detailDepthLimited || detail.depthLimited;
      continue;
    }
    passes.push(
      ...zPassDepths(ring.depthMm, depthPerPassMm).map((zMm) => ({
        kind: 'contour' as const,
        zMm,
        polyline: ringClosure(ring.polyline),
        closed: true,
      })),
    );
  }
  return { passes, detailDepthLimited };
}

// The junction blend (ADR-281 Amendment 2): a detail ring's vertices carry
// a conservative true-boundary groove profile, split through depthPerPassMm
// on the deepest vertex so plunge-load limits still hold. Shallower levels
// clamp each vertex to the level floor; the final level remains non-gouging
// after XYZ emission rounding and reports when its undercut bound is unavailable.
function detailPassesForRing(
  polyline: Polyline,
  depthPerPassMm: number,
  blend: DetailBlend,
): { readonly passes: ReadonlyArray<CncPass>; readonly depthLimited: boolean } {
  const profile = detailPath3dPlan(polyline, blend.segments, blend.law);
  const points = profile.points;
  let deepest = 0;
  for (const point of points) deepest = Math.min(deepest, point.z);
  if (deepest >= 0) return { passes: [], depthLimited: !profile.toleranceMet };
  return {
    passes: zPassDepths(-deepest, depthPerPassMm).map((levelZ) => ({
      kind: 'path3d' as const,
      points: points.map((point) => ({ x: point.x, y: point.y, z: Math.max(point.z, levelZ) })),
      closed: true,
      // These are cutting profiles, not entry ramps, but every lateral segment
      // can descend. Use the total plunge feed so its Z component cannot exceed
      // the operator's configured plunge rate.
      lateralFeed: 'plunge' as const,
    })),
    depthLimited: !profile.toleranceMet,
  };
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
