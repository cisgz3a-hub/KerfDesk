// Rotary taper warp (ADR-694; LightBurn's Taper Warp; rolling audit v12 X8-P2-2).
//
// The rotary's Y scale turns the object by surface mm measured at ONE diameter,
// the Object diameter. On a tapered tumbler that is wrong everywhere else: one
// surface mm is a bigger angle where the part is narrower. The warp runs in
// design space just before the Y scale, as its own step:
//
//   y' = base + (y − base) · R / r(x)
//
// R is the Object diameter's radius, the one the Y scale turns surface mm at;
// r(x) is the cone's radius where design X lies; base is the row the warp
// keeps fixed (the placement anchor, or an Absolute job's middle row). After
// the Y scale every point's machine Y is its angle round the part times one
// constant, so a design D mm tall burns D mm round the part at every height,
// and one turn of surface at any height (2π·r(x)) is exactly one turn.
//
// A cone cannot keep both that and every stroke along the side on a straight
// line up the part: a point a mm round the part from the base row sits a mm
// from it at every height, so such a stroke leans by atan(a·|dr/ds|/r). On an
// Ø80→Ø70 cup 100 mm long that is 2.3° at 30 mm from the base row. Rows round
// the part stay level, which is what a tumbler wrap needs.
//
// X is not warped. Like LightBurn, the object is held so the surface being
// engraved is level with the bed; the head then runs along the cone's side and
// design X is distance along that side (the slant), mm for mm. Where on the
// side each X lies comes from the job: the artwork's top-side edge sits
// `artworkFromTopMm` from the object's top.
//
// Identity, and the job returned unchanged, when the setup has no active taper:
// every project saved before ADR-694 keeps its output byte for byte.

import { activeRotaryTaper, type RotarySetup } from '../devices/rotary';
import type { Vec2 } from '../scene';
import { withoutArcMoves } from './cut-arc-moves';
import type { CutSegment, FillSegment, Job } from './job';
import {
  warpRotaryTaperBounds,
  warpRotaryTaperPoint,
  type RotaryTaperProfile,
} from './rotary-taper-profile';
import { warpRasterGroup } from './rotary-taper-raster';
import { jobYRange } from './rotary-transform';

// A warped chord may sit this far (design mm) from the true curve. The Y scale
// only shrinks it on a chuck; G-code writes 0.001 mm.
const CHORD_TOLERANCE_MM = 0.001;
const MAX_SPLIT_DEPTH = 12;

/** The warp this job gets on this setup, or null when there is none. */
export function rotaryTaperProfile(job: Job, setup: RotarySetup): RotaryTaperProfile | null {
  const taper = activeRotaryTaper(setup);
  if (taper === null) return null;
  const xRange = jobXRange(job);
  const yRange = jobYRange(job);
  if (xRange === null || yRange === null) return null;
  const direction = taper.topSide === 'left' ? 1 : -1;
  const artworkTopEdge = direction === 1 ? xRange.min : xRange.max;
  return {
    referenceRadiusMm: setup.objectDiameterMm / 2,
    topX: artworkTopEdge - direction * taper.artworkFromTopMm,
    direction,
    topRadiusMm: taper.topDiameterMm / 2,
    bottomRadiusMm: taper.bottomDiameterMm / 2,
    lengthMm: taper.lengthMm,
    // A placed job keeps its anchor where the part already is (ADR-127 Amd 1).
    // An Absolute job is rebased afterwards anyway, so it pivots on its middle
    // row: strokes along the side lean least that way (see the header).
    baseY: job.rotaryAnchorY ?? (yRange.min + yRange.max) / 2,
  };
}

/** Warps a surface-space job for a tapered part; see the header. */
export function applyRotaryTaperWarp(job: Job, setup: RotarySetup): Job {
  const profile = rotaryTaperProfile(job, setup);
  if (profile === null) return job;
  const bounds = job.contourEntryBounds;
  return {
    ...job,
    rotaryTaper: profile,
    ...(bounds == null ? {} : { contourEntryBounds: warpRotaryTaperBounds(profile, bounds) }),
    groups: job.groups.map((group) => {
      if (group.kind === 'cut') {
        return { ...group, segments: group.segments.map((s) => warpSegment(s, profile)) };
      }
      if (group.kind === 'fill') {
        return {
          ...group,
          segments: group.segments.map((s) => warpSegment(s, profile) as FillSegment),
        };
      }
      if (group.kind === 'raster') return warpRasterGroup(group, profile);
      return group;
    }),
  };
}

/** The X the warp reads positions along the side from: every burn's points. */
export function jobXRange(job: Job): { readonly min: number; readonly max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const take = (x: number): void => {
    min = Math.min(min, x);
    max = Math.max(max, x);
  };
  for (const group of job.groups) {
    if (group.kind === 'raster') {
      take(group.bounds.minX);
      take(group.bounds.maxX);
      continue;
    }
    if (group.kind !== 'cut' && group.kind !== 'fill') continue;
    for (const segment of group.segments) {
      for (const p of segment.polyline) take(p.x);
      for (const p of segment.finalPassBurn?.polyline ?? []) take(p.x);
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function warpSegment<T extends CutSegment>(segment: T, profile: RotaryTaperProfile): T {
  const main = warpPolyline(segment.polyline, profile);
  const finalPass = segment.finalPassBurn;
  const contour = segment.leadContour;
  return {
    ...withoutArcMoves(segment),
    polyline: main.points,
    ...(finalPass === undefined
      ? {}
      : { finalPassBurn: { polyline: warpPolyline(finalPass.polyline, profile).points } }),
    // The contour's first and last vertex keep naming the same points; its
    // arcs, like every arc here, become the chords the rotary runs.
    ...(contour === undefined
      ? {}
      : {
          leadContour: {
            from: main.indexOf[contour.from] ?? contour.from,
            to: main.indexOf[contour.to] ?? contour.to,
          },
        }),
  };
}

/** Warps a polyline, adding vertices where a straight design edge becomes a
 * curve (any edge with an X extent). `indexOf[i]` is source vertex i's index. */
function warpPolyline(
  polyline: ReadonlyArray<Vec2>,
  profile: RotaryTaperProfile,
): { readonly points: ReadonlyArray<Vec2>; readonly indexOf: ReadonlyArray<number> } {
  const points: Vec2[] = [];
  const indexOf: number[] = [];
  polyline.forEach((point, index) => {
    const previous = polyline[index - 1];
    if (previous !== undefined) pushSplitEdge(points, previous, point, profile, 0);
    indexOf.push(points.length);
    points.push(warpRotaryTaperPoint(profile, point));
  });
  return { points, indexOf };
}

// Appends the warped interior points of a → b (not a, not b). The warped edge
// is y' = base + (y − base)·R/r(x) with r linear in x: a smooth curve, so a
// midpoint within tolerance of its chord means the whole piece is.
function pushSplitEdge(
  out: Vec2[],
  a: Vec2,
  b: Vec2,
  profile: RotaryTaperProfile,
  depth: number,
): void {
  if (a.x === b.x || depth >= MAX_SPLIT_DEPTH) return;
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const wa = warpRotaryTaperPoint(profile, a);
  const wb = warpRotaryTaperPoint(profile, b);
  const wm = warpRotaryTaperPoint(profile, middle);
  if (Math.abs(wm.y - (wa.y + wb.y) / 2) <= CHORD_TOLERANCE_MM) return;
  pushSplitEdge(out, a, middle, profile, depth + 1);
  out.push(wm);
  pushSplitEdge(out, middle, b, profile, depth + 1);
}
