// pocketToolpathRings — contour-parallel pocket clearing.
//
// A pocket removes all material inside closed shapes. We generate successive
// inward offsets of the boundary ("rings"): ring 0 is inset by the tool
// radius (the finishing wall), ring k by radius + k * stepover. Rings are
// emitted innermost-first so the bulk is cleared before the finishing ring
// runs along the wall. Islands (holes inside the pocket contour) are handled
// by the containment-aware offset: hole boundaries grow as the outer shrinks,
// so rings never enter the island.
//
// Each ring offsets from the ORIGINAL contours (not the previous ring) to
// avoid accumulating clipper approximation error across many rings.
//
// The ladder reports WHY it ended (offset-ladder.ts): a pocket cut short by an
// offset-engine failure looks exactly like a finished one, and on a router the
// leftover material meets a later pass that believed it was cleared.

import { buildOffsetLadder, insetContoursChecked } from '../geometry/offset-ladder';
import {
  differenceClosedPolylinesChecked,
  normalizeClosedPolylineTreeEvenOddChecked,
  type NormalizedPolylineTreeNode,
} from '../geometry/polygon-difference';
import { roundStrokeOutline } from '../geometry/round-stroke-outline';
import { fillHatchingExactWithBudget } from '../job/fill-hatching';
import type { Polyline } from '../scene';
import { hasFinitePoints } from './profile-paths';

const MIN_CLOSED_POINTS = 3;
const MIN_STEPOVER_PERCENT = 10;
// Existing backstop against degenerate inputs (huge pocket + microscopic
// effective stepover). This slice preserves current-main planner semantics.
const MAX_POCKET_RINGS = 4096;
const MAX_POCKET_RASTER_SCANLINES = 4096;
// Bisection for the innermost ring: 24 halvings resolve any bed-sized span to
// well under the tolerance, and 0.01 mm is finer than the 3-decimal emit grid.
const RING_BISECT_ITERATIONS = 24;
const RING_BISECT_TOLERANCE_MM = 0.01;

export type PocketToolpaths = {
  readonly toolpaths: ReadonlyArray<Polyline>;
  // True when the ring ladder stopped on an offset-engine failure rather than
  // on running out of interior: the pocket is truncated and material is still
  // standing in it. Surfaced as a Job Review warning, never a refusal (rule 7).
  readonly offsetFailed: boolean;
  // The inherited ring planner exhausted its fixed ladder budget. This field
  // only exposes existing behavior; this slice does not create partial raster
  // output or expand microscopic-Stepover reach.
  readonly passLimited: boolean;
  // True only when this invocation reached the spacing-dependent planner.
  // Compile evidence uses this instead of inferring consumption from settings.
  readonly stepoverUsed: boolean;
};

const NO_POCKET_TOOLPATHS: PocketToolpaths = {
  toolpaths: [],
  offsetFailed: false,
  passLimited: false,
  stepoverUsed: false,
};

export function pocketToolpathRings(
  polylines: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  stepoverPercent: number,
): ReadonlyArray<Polyline> {
  return pocketRingToolpaths(polylines, toolDiameterMm, stepoverPercent).toolpaths;
}

// Same rings as pocketToolpathRings, keeping the reason the ladder ended for
// callers that can report a truncated pocket instead of silently shipping one.
export function pocketRingToolpaths(
  polylines: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  stepoverPercent: number,
): PocketToolpaths {
  const contours = pocketContours(polylines);
  if (contours.length === 0 || !(toolDiameterMm > 0)) return NO_POCKET_TOOLPATHS;
  const radius = toolDiameterMm / 2;
  const stepMm = (positiveStepoverPercent(stepoverPercent) / 100) * toolDiameterMm;

  const ladder = buildOffsetLadder(contours, MAX_POCKET_RINGS, (step) => radius + step * stepMm);
  const core = coreRing(contours, ladder.rings, radius, stepMm);
  const rings = core.ring === null ? ladder.rings : [...ladder.rings, core.ring];
  const toolpaths = innermostFirst(rings);
  const remaining =
    stepMm > radius && !ladder.capped && !ladder.offsetFailed && !core.offsetFailed
      ? remainingPocketCores(ladder.rings[0] ?? [], toolpaths, toolDiameterMm)
      : { toolpaths: [], offsetFailed: false };
  return {
    // Innermost ring first, boundary (ring 0) last as the finishing pass.
    toolpaths: [...remaining.toolpaths, ...toolpaths],
    offsetFailed: ladder.offsetFailed || core.offsetFailed || remaining.offsetFailed,
    passLimited: ladder.capped,
    stepoverUsed: true,
  };
}

// A component may disappear before the GLOBAL deepest ring, including a lobe
// that splits and collapses between two regular insets. Find its actual uncut
// material from the cutter sweep, retaining the ordinary stepover rings.
// Clip to the first ring's tool-center region: every added centerline stays
// inside the pocket and outside its islands, without trying to clear corners
// the configured cutter cannot reach.
function remainingPocketCores(
  centerRegion: ReadonlyArray<Polyline>,
  toolpaths: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
): Pick<PocketToolpaths, 'toolpaths' | 'offsetFailed'> {
  if (toolpaths.length === 0) return { toolpaths: [], offsetFailed: false };
  const cleared = roundStrokeOutline(toolpaths, toolDiameterMm);
  if (cleared === null) return { toolpaths: [], offsetFailed: true };
  const remaining = differenceClosedPolylinesChecked(centerRegion, cleared);
  return remaining.kind === 'error'
    ? { toolpaths: [], offsetFailed: true }
    : { toolpaths: remaining.value, offsetFailed: false };
}

// A stepover wider than the tool RADIUS can leave the last ring further from
// the medial axis than the cutter reaches, so the pocket keeps a full-depth
// core: a 6.35 mm bit at 85% in an R=8.175 pocket gets one ring at 5.0 and
// sweeps only to r=1.825, leaving a 3.65 mm pillar. Bisect for the deepest
// offset that still yields a ring instead of clamping the operator's
// stepover. At stepover <= 50% the final ring's sweep always covers the
// centre, so this never runs and output is unchanged.
function coreRing(
  contours: ReadonlyArray<Polyline>,
  rings: ReadonlyArray<ReadonlyArray<Polyline>>,
  radius: number,
  stepMm: number,
): DeepestRing {
  const lastRing = rings.length - 1;
  if (!(stepMm > radius) || lastRing < 0 || rings.length >= MAX_POCKET_RINGS) {
    return NO_DEEPEST_RING;
  }
  const lastInset = radius + lastRing * stepMm;
  const topology = normalizeClosedPolylineTreeEvenOddChecked(contours);
  if (topology.kind === 'error') return { ring: null, offsetFailed: true };
  const regions = solidRegions(topology.value);
  if (regions.length <= 1) return deepestRing(contours, lastInset, lastInset + stepMm);
  // Keep the existing central cleanup for EACH independent region, even when
  // the operator chooses spacing wider than a diameter. Local sweep-boundary
  // cleanup alone need not reach the center of such a wide leftover core.
  const cores: Polyline[] = [];
  let offsetFailed = false;
  for (const region of regions) {
    const first = insetContoursChecked(region, radius);
    if (first.offsetFailed) offsetFailed = true;
    if (first.contours.length === 0) continue;
    const core = deepestRing(region, radius, lastInset + stepMm);
    if (core.ring !== null) cores.push(...core.ring);
    offsetFailed ||= core.offsetFailed;
  }
  return { ring: cores.length === 0 ? null : cores, offsetFailed };
}

function solidRegions(
  nodes: ReadonlyArray<NormalizedPolylineTreeNode>,
): ReadonlyArray<ReadonlyArray<Polyline>> {
  const regions = new Map<number, Polyline[]>();
  nodes.forEach((node, index) => {
    if (!node.isHole) regions.set(index, [node.contour]);
    else if (node.parentIndex !== null) regions.get(node.parentIndex)?.push(node.contour);
  });
  return [...regions.values()];
}

type DeepestRing = {
  readonly ring: ReadonlyArray<Polyline> | null;
  readonly offsetFailed: boolean;
};

const NO_DEEPEST_RING: DeepestRing = { ring: null, offsetFailed: false };

// Largest inset in (lo, hi] that still offsets to a non-empty ring — the
// deepest ring the pocket geometry admits. lo is known good and hi known empty,
// so a plain bisection converges on the medial axis to within the tolerance.
// A null ring means nothing deeper than lo exists, leaving output untouched.
function deepestRing(contours: ReadonlyArray<Polyline>, lo: number, hi: number): DeepestRing {
  let low = lo;
  let high = hi;
  let best: ReadonlyArray<Polyline> | null = null;
  for (let i = 0; i < RING_BISECT_ITERATIONS && high - low > RING_BISECT_TOLERANCE_MM; i += 1) {
    const mid = (low + high) / 2;
    const inset = insetContoursChecked(contours, mid);
    // A failed offset says nothing about whether a ring exists at mid, so the
    // bisection's invariant (hi is empty because the region ENDED) no longer
    // holds. Stop and report rather than keep searching on a false premise.
    if (inset.offsetFailed) return { ring: best, offsetFailed: true };
    if (inset.contours.length === 0) {
      high = mid;
    } else {
      low = mid;
      best = inset.contours;
    }
  }
  return { ring: best, offsetFailed: false };
}

function innermostFirst(rings: ReadonlyArray<ReadonlyArray<Polyline>>): ReadonlyArray<Polyline> {
  const out: Polyline[] = [];
  for (let k = rings.length - 1; k >= 0; k -= 1) {
    const ring = rings[k];
    if (ring !== undefined) out.push(...ring);
  }
  return out;
}

function pocketContours(polylines: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  return polylines.filter(
    (polyline) =>
      polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline),
  );
}

function positiveStepoverPercent(stepoverPercent: number): number {
  return Number.isFinite(stepoverPercent) && stepoverPercent > 0
    ? stepoverPercent
    : MIN_STEPOVER_PERCENT;
}

// Raster pocket clearing (ADR-105 G10) — Easel's Fill Method raster X/Y.
// The region reachable by the bit CENTER is the contour inset by one radius;
// serpentine sweeps at the stepover spacing clear it, then the inset
// perimeter runs last as the finishing wall pass.
export function pocketToolpathRaster(
  polylines: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  stepoverPercent: number,
  axis: 'x' | 'y',
): ReadonlyArray<Polyline> {
  return pocketRasterToolpaths(polylines, toolDiameterMm, stepoverPercent, axis).toolpaths;
}

// The wall inset is a one-shot offset, but an empty result ends the raster
// pocket just as silently as an empty ring ends the ring ladder — so it draws
// the same failure-vs-no-interior distinction.
export function pocketRasterToolpaths(
  polylines: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  stepoverPercent: number,
  axis: 'x' | 'y',
): PocketToolpaths {
  const contours = pocketContours(polylines);
  if (contours.length === 0 || !(toolDiameterMm > 0)) return NO_POCKET_TOOLPATHS;
  const stepMm = (positiveStepoverPercent(stepoverPercent) / 100) * toolDiameterMm;
  const wall = insetContoursChecked(contours, toolDiameterMm / 2);
  if (wall.contours.length === 0) {
    return {
      toolpaths: [],
      offsetFailed: wall.offsetFailed,
      passLimited: false,
      stepoverUsed: true,
    };
  }
  const sweeps = fillHatchingExactWithBudget(
    {
      polylines: wall.contours,
      hatchAngleDeg: axis === 'x' ? 0 : 90,
      hatchSpacingMm: stepMm,
      fillRule: 'nonzero',
      bidirectional: true,
    },
    MAX_POCKET_RASTER_SCANLINES,
  );
  return {
    toolpaths: [...sweeps.hatches, ...wall.contours],
    offsetFailed: false,
    passLimited: sweeps.passLimited,
    stepoverUsed: true,
  };
}
