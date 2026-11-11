// applyRotaryYScale — map a compiled job's Y coordinates into rotary space
// (ADR-127 N1): scale surface mm into machine-rotation mm. Rotation is
// relative to wherever the cylinder currently is, so the design's flat-bed Y
// is meaningless on a rotary; only its extent matters. A placed job keeps its
// placement anchor (`Job.rotaryAnchorY`, ADR-127 Amendment 1): the anchor's
// work Y is where the cylinder already is, and the job scales around it. An
// Absolute job has no anchor and is REBASED so its lowest Y sits at 0. Runs at
// the LAST moment (inside emitGcode, after prepareOutput), so previews/estimates
// keep showing surface-true geometry. Raster groups map their bounds through
// the same transform; reverse mode maps source-row traversal onto descending Y.

import { withoutArcMoves } from './cut-arc-moves';
import { maxOf, minOf } from '../util/spread-free';
import {
  normalizedScanAngleDeg,
  rasterScanFrame,
  scanRectMachineCorners,
} from '../raster/raster-scan-frame';
import type { CutSegment, FillSegment, Job, RasterGroup } from './job';
import type { Vec2 } from '../scene';

/** Inverse of the emitted rotary mapping for truthful surface-relative markers. */
export function restoreRotarySurfacePoint(
  job: Job,
  point: Vec2,
  yScale: number,
  reverse = false,
  zeroAtAnchor = false,
): Vec2 {
  const map = rotaryYMap(job, yScale, reverse, zeroAtAnchor);
  if (map === null) return point;
  const forward = reverse ? map.reverseOriginY - point.y : point.y - map.forwardOriginY;
  return { x: point.x, y: map.baseY + forward / yScale };
}

/** Surface Y `baseY` lands on `forwardOriginY`, or on `reverseOriginY` when
 * the rotary is reversed; every other Y follows at `scale` mm per mm. */
type RotaryYMap = {
  readonly baseY: number;
  readonly forwardOriginY: number;
  readonly reverseOriginY: number;
  readonly scale: number;
  readonly reverse: boolean;
};

// reverse (ADR-127): the rotary can spin the opposite way (chuck mounted
// backwards, or roller/gearing that inverts direction), which mirrors the
// engraving around the cylinder. An Absolute job mirrors Y within the wrap
// window [0, extent], so its bounds stay that window either way. A placed job
// mirrors about its anchor, which stays where the cylinder already is.
// zeroAtAnchor (ADR-695): a dedicated A or Z axis starts each job at 0, so the
// anchor lands there instead of on the head's work Y.
function rotaryYMap(
  job: Job,
  scale: number,
  reverse: boolean,
  zeroAtAnchor = false,
): RotaryYMap | null {
  const range = jobYRange(job);
  if (range === null) return null;
  const anchor = job.rotaryAnchorY;
  if (anchor !== undefined) {
    const origin = zeroAtAnchor ? 0 : anchor;
    return { baseY: anchor, forwardOriginY: origin, reverseOriginY: origin, scale, reverse };
  }
  const extent = (range.max - range.min) * scale;
  return { baseY: range.min, forwardOriginY: 0, reverseOriginY: extent, scale, reverse };
}

function mapRotaryY(map: RotaryYMap, y: number): number {
  const forward = (y - map.baseY) * map.scale;
  return map.reverse ? map.reverseOriginY - forward : map.forwardOriginY + forward;
}

/** Maps a Y interval; reverse swaps which end is low. */
function mapRotaryYRange(
  map: RotaryYMap,
  minY: number,
  maxY: number,
): { readonly minY: number; readonly maxY: number } {
  const low = mapRotaryY(map, minY);
  const high = mapRotaryY(map, maxY);
  return map.reverse ? { minY: high, maxY: low } : { minY: low, maxY: high };
}

export function applyRotaryYScale(
  job: Job,
  yScale: number,
  reverse = false,
  zeroAtAnchor = false,
): Job {
  const map = rotaryYMap(job, yScale, reverse, zeroAtAnchor);
  if (map === null) return job;
  if (yScale === 1 && !reverse && map.baseY === map.forwardOriginY) return job;
  const mapCut = <T extends CutSegment>(s: T): T => mapSegment(s, map);
  return {
    ...job,
    // ADR-127 Amd 2: the emitters match each move's feed to the surface.
    ...(yScale === 1 ? {} : { rotarySurfaceYScale: yScale }),
    ...(job.contourEntryBounds == null
      ? {}
      : {
          contourEntryBounds: {
            ...job.contourEntryBounds,
            ...mapRotaryYRange(map, job.contourEntryBounds.minY, job.contourEntryBounds.maxY),
          },
        }),
    groups: job.groups.map((group) => {
      if (group.kind === 'cut') return { ...group, segments: group.segments.map(mapCut) };
      if (group.kind === 'fill') {
        return { ...group, segments: group.segments.map((s) => mapCut(s) as FillSegment) };
      }
      if (group.kind === 'raster') return mapRasterGroup(group, map);
      return group;
    }),
  };
}

/** The Y the rotary rebases and wraps: every burn's points, final passes included. */
export function jobYRange(job: Job): { readonly min: number; readonly max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const group of job.groups) {
    if (group.kind === 'raster') {
      const raster = rasterMachineYRange(group);
      min = Math.min(min, raster.min);
      max = Math.max(max, raster.max);
      continue;
    }
    if (group.kind !== 'cut' && group.kind !== 'fill') continue;
    for (const segment of group.segments) {
      for (const p of segment.polyline) {
        min = Math.min(min, p.y);
        max = Math.max(max, p.y);
      }
      // ADR-626: a final pass with an overcut leaves by its own lead-out.
      for (const p of segment.finalPassBurn?.polyline ?? []) {
        min = Math.min(min, p.y);
        max = Math.max(max, p.y);
      }
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

// ADR-699 Amd 1: a turned raster's bounds are in its scan frame, not bed Y.
function rasterMachineYRange(group: RasterGroup): { readonly min: number; readonly max: number } {
  const ys = scanRectMachineCorners(rasterScanFrame(group.scanAngleDeg), group.bounds).map(
    (corner) => corner.y,
  );
  return { min: minOf(ys), max: maxOf(ys) };
}

function mapRasterGroup(group: RasterGroup, map: RotaryYMap): RasterGroup {
  // ADR-492 D9 and ADR-699 Amd 1: compilation scans every raster along X on a
  // rotary. A turned one cannot be scaled round the part, so it never runs.
  if (normalizedScanAngleDeg(group.scanAngleDeg) !== 0) {
    throw new Error(
      'A raster scanned at an angle cannot run on a rotary; rotary rasters scan along X.',
    );
  }
  return {
    ...group,
    bounds: { ...group.bounds, ...mapRotaryYRange(map, group.bounds.minY, group.bounds.maxY) },
    ...(map.reverse ? reverseRasterValues(group) : {}),
  };
}

function reverseRasterValues(
  group: RasterGroup,
): Pick<RasterGroup, 'sValues' | 'rowProvider' | 'rowProviderOrder'> {
  return {
    sValues: group.sValues,
    ...(group.rowProvider === undefined ? {} : { rowProvider: group.rowProvider }),
    rowProviderOrder: group.rowProviderOrder === 'descending-y' ? 'ascending-y' : 'descending-y',
  };
}

function mapSegment<T extends CutSegment>(segment: T, map: RotaryYMap): T {
  // A Y scale turns arcs into ellipses; the chords are what the rotary runs.
  const mapPoint = (p: Vec2): Vec2 => ({ x: p.x, y: mapRotaryY(map, p.y) });
  const finalPass = segment.finalPassBurn;
  const contour = segment.leadContour;
  return {
    ...withoutArcMoves(segment),
    polyline: segment.polyline.map(mapPoint),
    // ADR-626: the final pass's own burn moves with the rest of the segment.
    ...(finalPass === undefined
      ? {}
      : { finalPassBurn: { polyline: finalPass.polyline.map(mapPoint) } }),
    // Retained editing geometry follows the same no-arcs rule as the burn.
    ...(contour === undefined ? {} : { leadContour: { from: contour.from, to: contour.to } }),
  };
}
