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
// over exactly that uncovered material (vcarve-thin-detail.ts, ADR-282)
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

import { buildOffsetLadder, type OffsetLadder } from '../geometry/offset-ladder';
import { normalizeClosedPolylinesEvenOddChecked } from '../geometry/polygon-difference';
import type { CncPass } from '../job';
import type { CncTool, Polyline } from '../scene';
import { zPassDepths } from './depth-passes';
import { vcarveIncludedAngleDeg } from './vcarve-angle';
import { vcarveAxisTail, type AxisTail } from './vcarve-axis-tail';
import { isVCarvableContour } from './vcarve-carvable-contours';
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
  // blend on the stepped path (per-vertex depths, ADR-282 Amendment 2); axis
  // rings are the medial-axis tail and always plunge (see passesForRings).
  readonly kind: 'ring' | 'detail' | 'axis';
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
  const coarse = coarseLadderWithAxisTail(contours, ladder, delta, {
    tanHalf,
    maxDepthMm: maxDepth,
  });
  // A failed ladder's coverage is unknowable — a detail pass against it would
  // re-carve everything at fine pitch. offsetFailed already reports the gap.
  const detail = ladder.offsetFailed
    ? NO_DETAIL
    : vcarveThinDetailRings(contours, ladder.rings[0] ?? [], delta, finePitchMm);
  const rings = zipRegionRings(sourceContours, contours, coarse.rings, detail, {
    coarseInsetsMm: coarse.insetsMm,
    axisFromStep: coarse.axisFromStep,
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
    ...ladderAdvisories(ladder, detail, {
      tailFailed: coarse.tailFailed,
      pitchDegraded,
      detailDepthLimited,
    }),
  };
}

// Job Review's V-carve advisories, rolled up from every stage that can leave
// the carve short of the artwork. All advisory, never refusals (rule 7).
function ladderAdvisories(
  ladder: OffsetLadder,
  detail: ThinDetailRings,
  stage: {
    readonly tailFailed: boolean;
    readonly pitchDegraded: boolean;
    readonly detailDepthLimited: boolean;
  },
): Pick<VCarveLadder, 'offsetFailed' | 'thinResidual' | 'passLimited'> {
  return {
    offsetFailed: ladder.offsetFailed || detail.offsetFailed || stage.tailFailed,
    thinResidual: detail.residualThin,
    passLimited: stage.pitchDegraded || ladder.capped || detail.capped || stage.detailDepthLimited,
  };
}

function validVCarveContours(polylines: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  return polylines.filter(isVCarvableContour);
}

type CoarseLadder = {
  readonly rings: ReadonlyArray<ReadonlyArray<Polyline>>;
  // Inset of each ring by step index — the uniform δ prefix, then the tail.
  readonly insetsMm: ReadonlyArray<number>;
  // First step index belonging to the medial-axis tail; steps below it are δ
  // ladder rings. Equal to the ring count when there is no tail.
  readonly axisFromStep: number;
  readonly tailFailed: boolean;
};

// The δ ladder stops at the first inset that yields nothing, so its deepest
// ring sits up to δ short of the medial axis and leaves a standing ridge down
// the centre of every stroke. Bisect that last bracket onto the axis
// (vcarve-axis-tail.ts) and append the result. Skipped when the ladder ended
// for any other reason: a failed offset makes the bracket meaningless, and a
// capped ladder never reached an empty inset at all.
//
// The tail extends the SAME ring array, so a step stays an index into it and
// the region layout needs no notion of a non-uniform pitch. Only the depth law
// reads the inset, and it reads it per ring rather than per step.
function coarseLadderWithAxisTail(
  contours: ReadonlyArray<Polyline>,
  ladder: OffsetLadder,
  deltaMm: number,
  law: DetailDepthLaw,
): CoarseLadder {
  const lastInsetMm = ladder.rings.length * deltaMm;
  // Once the groove bottoms out on maxDepth the ridge cannot exist: every
  // remaining ring cuts the same floor, and a clamped ring's cone footprint
  // (maxDepth·tan(θ/2) radius, never narrower than δ by construction) already
  // sweeps the axis. A tail ring there would only repeat the floor for an extra
  // lap. The ridge is reachable only while the depth still tracks the wall, so
  // that is the only case worth bisecting.
  const isDepthClamped = lastInsetMm / law.tanHalf >= law.maxDepthMm;
  const tail =
    ladder.offsetFailed || ladder.capped || isDepthClamped
      ? NO_TAIL
      : vcarveAxisTail(contours, lastInsetMm, lastInsetMm + deltaMm);
  return {
    rings: [...ladder.rings, ...tail.rings.map((ring) => ring.polylines)],
    insetsMm: [
      ...ladder.rings.map((_ring, step) => (step + 1) * deltaMm),
      ...tail.rings.map((ring) => ring.insetMm),
    ],
    axisFromStep: ladder.rings.length,
    tailFailed: tail.offsetFailed,
  };
}

const NO_LADDER: VCarveLadder = {
  passes: [],
  offsetFailed: false,
  entryIssue: null,
  thinResidual: false,
  passLimited: false,
};
const NO_TAIL: AxisTail = { rings: [], offsetFailed: false };
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
// rings, then its detail, before the cutter travels on (ADR-270, ADR-282).
type RingDepthClamp = {
  // Inset of each coarse ring by step index. The δ rings are the uniform
  // prefix; the medial-axis tail appends off-grid insets after them.
  readonly coarseInsetsMm: ReadonlyArray<number>;
  // First coarse step belonging to the medial-axis tail.
  readonly axisFromStep: number;
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
      ...ringsForBucket(
        coarse[bucket] ?? [],
        (step) => clamp.coarseInsetsMm[step] ?? (step + 1) * clamp.deltaMm,
        clamp,
        'ring',
      ),
      ...ringsForBucket(
        orderDetailBySliver(fine[bucket] ?? [], detail.sliverRoots),
        (step) => (step + 1) * clamp.finePitchMm,
        clamp,
        'detail',
      ),
    );
  }
  return rings;
}

function ringsForBucket(
  entries: ReadonlyArray<OrderedVCarvePolyline>,
  insetMmForStep: (step: number) => number,
  clamp: RingDepthClamp,
  kind: VCarveRing['kind'],
): ReadonlyArray<VCarveRing> {
  return entries.map(({ step, polyline }) => ({
    kind: kind === 'ring' && step >= clamp.axisFromStep ? ('axis' as const) : kind,
    polyline,
    depthMm: Math.min(insetMmForStep(step) / clamp.tanHalf, clamp.maxDepthMm),
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
  // Axis rings never ramp (see below), so the ramp request is validated against
  // the first ring that actually would.
  const firstRing = rings.find((ring) => ring.kind !== 'axis');
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
  const passes: CncPass[] = [];
  for (const ring of rings) {
    // The medial-axis ring is a closed loop at the bottom of the groove, often
    // only micrometres of inset wide. There is no room to ramp along it and
    // nothing to ramp into: the reference behaviour ramps the CLEARANCE tool's
    // plunges, not the V-bit's carving passes (Vectric V-Carve, "Ramp Plunge
    // Moves" under Flat Area Clearance). A pointed bit is centre-cutting at the
    // tip, so it plunges by design. Skipping the planner here keeps every other
    // ring's ramp instead of collapsing the whole job to legacy entry over a
    // ring that was never meant to ramp.
    if (ring.kind === 'axis') {
      passes.push(...steppedContourPasses(ring, depthPerPassMm));
      continue;
    }
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
    passes.push(...steppedContourPasses(ring, depthPerPassMm));
  }
  return { passes, detailDepthLimited };
}

// The legacy entry: one closed contour per depth level, each reached by a
// straight plunge at the ring's own start point.
function steppedContourPasses(ring: VCarveRing, depthPerPassMm: number): ReadonlyArray<CncPass> {
  return zPassDepths(ring.depthMm, depthPerPassMm).map((zMm) => ({
    kind: 'contour' as const,
    zMm,
    polyline: ringClosure(ring.polyline),
    closed: true,
  }));
}

// The junction blend (ADR-282 Amendment 2): a detail ring's vertices carry
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
