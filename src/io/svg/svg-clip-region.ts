// Turns resolved clip paths into the document-space region they keep, and
// intersects filled artwork with it (ADR-358 Amendment 2).
//
// Precision: curves in clip outlines and in the artwork a clip cuts are
// flattened at DEFAULT_MACHINE_CURVE_TOLERANCE_MM, the tolerance job
// compilation flattens native curves at, so clipped geometry cuts as finely as
// the unclipped curve would have. Clipper2 works on the same 1 µm grid as the
// in-app Boolean tools. Every clip region is normalised: its rings are
// disjoint outlines and holes, so it reads the same under either fill rule.
//
// Cost: each element meets only the part of the region around it, cropped by
// Clipper2's rectangle clip, so a detailed clip outline is not re-swept in
// full for every element it clips.

import {
  areaPathsD,
  differenceD,
  FillRule,
  intersectD,
  RectClip64,
  unionD,
  type PathD,
  type Paths64,
  type PathsD,
} from 'clipper2-ts';
import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  type Vec2,
} from '../../core/scene';
import type { SubPath } from './parse-path-d';
import { elementToSubPaths } from './shape-to-polylines';
import type { ResolvedSvgClip, SvgClipShape } from './svg-clip-resolve';
import { applySvgMatrix, transformSvgCurveSubpath, type SvgMatrix } from './svg-curve-transform';
import { assertSvgImportPoints } from './svg-import-budget';
import { linearScaleMagnitude } from './transform-scale';

export const SVG_CLIP_PRECISION_DECIMALS = 3;
const GRID = 10 ** SVG_CLIP_PRECISION_DECIMALS;
// Area a clip may leave outside before it counts as cutting: grid dust only.
const UNCUT_AREA_MM2 = 1e-6;
// The crop window sits this far outside the artwork, so its edges never meet it.
const CROP_MARGIN_MM = 1;

export type SvgClipRegion = {
  /** Normalised rings in document millimetres. */
  readonly paths: PathsD;
  /** The same rings on the integer 1 µm grid, for cropping. */
  readonly grid: Paths64;
};

/** The region every clip in a chain keeps: their intersection. */
export function svgClipRegion(clips: ReadonlyArray<ResolvedSvgClip>): SvgClipRegion {
  let paths: PathsD | undefined;
  for (const clip of clips) {
    paths = paths === undefined ? clipRegion(clip) : intersectRegions(paths, clipRegion(clip));
  }
  const kept = paths ?? [];
  return {
    paths: kept,
    grid: kept.map((ring) =>
      ring.map((point) => ({ x: Math.round(point.x * GRID), y: Math.round(point.y * GRID) })),
    ),
  };
}

/** The region cropped to a margin around `rings`; exact wherever they lie. */
export function svgClipRegionAround(
  region: SvgClipRegion,
  rings: ReadonlyArray<ReadonlyArray<Vec2>>,
): PathsD {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const point of rings.flat()) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }
  if (!Number.isFinite(bounds.minX) || region.grid.length === 0) return [];
  const crop = new RectClip64({
    left: Math.floor((bounds.minX - CROP_MARGIN_MM) * GRID),
    top: Math.floor((bounds.minY - CROP_MARGIN_MM) * GRID),
    right: Math.ceil((bounds.maxX + CROP_MARGIN_MM) * GRID),
    bottom: Math.ceil((bounds.maxY + CROP_MARGIN_MM) * GRID),
  });
  return crop
    .execute(region.grid)
    .map((ring) => ring.map((point) => ({ x: point.x / GRID, y: point.y / GRID })));
}

/**
 * Filled artwork against a region. `null` means the region keeps all of it;
 * otherwise the kept polygons, possibly none.
 */
export function intersectFilledRings(
  rings: PathsD,
  rule: 'nonzero' | 'evenodd',
  region: SvgClipRegion,
): PathsD | null {
  const local = svgClipRegionAround(region, rings);
  if (rings.length === 0 || local.length === 0) return [];
  // The region is normalised, so the artwork's own rule reads it correctly too.
  const kept = intersectD(rings, local, fillRule(rule), SVG_CLIP_PRECISION_DECIMALS);
  if (kept.length === 0) return [];
  const outside = differenceD(rings, local, fillRule(rule), SVG_CLIP_PRECISION_DECIMALS);
  return Math.abs(areaPathsD(outside)) <= UNCUT_AREA_MM2 ? null : kept;
}

/** A subpath in document millimetres, curves flattened at the machine tolerance. */
export function machineDocumentPoints(subpath: SubPath, matrix: SvgMatrix): PathD {
  if (subpath.curve !== undefined) {
    const flattened = flattenCurveSubpath(transformSvgCurveSubpath(subpath.curve, matrix), {
      toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
      segmentBudget: Number.MAX_SAFE_INTEGER,
    });
    if (flattened.kind === 'ok') {
      assertSvgImportPoints(flattened.polyline.points);
      return flattened.polyline.points.map((point) => ({ x: point.x, y: point.y }));
    }
  }
  const points = subpath.points.map((point) => applySvgMatrix(matrix, point));
  assertSvgImportPoints(points);
  return points;
}

function clipRegion(clip: ResolvedSvgClip): PathsD {
  const parts = clip.shapes.map(shapeRegion).filter((part) => part.length > 0);
  let region =
    parts.length <= 1
      ? (parts[0] ?? [])
      : unionD(parts.flat(), [], FillRule.NonZero, SVG_CLIP_PRECISION_DECIMALS);
  for (const nested of clip.clips) region = intersectRegions(region, clipRegion(nested));
  return region;
}

function shapeRegion(shape: SvgClipShape): PathsD {
  const { matrix } = shape;
  const scale = linearScaleMagnitude(matrix.a, matrix.b, matrix.c, matrix.d);
  // A clip child contributes its fill area: every subpath implicitly closes.
  const rings = elementToSubPaths(shape.element, scale)
    .map((subpath) => machineDocumentPoints(subpath, matrix))
    .filter((ring) => ring.length >= 3);
  let region =
    rings.length === 0 ? [] : unionD(rings, [], fillRule(shape.rule), SVG_CLIP_PRECISION_DECIMALS);
  for (const nested of shape.clips) region = intersectRegions(region, clipRegion(nested));
  return region;
}

function intersectRegions(left: PathsD, right: PathsD): PathsD {
  if (left.length === 0 || right.length === 0) return [];
  return intersectD(left, right, FillRule.NonZero, SVG_CLIP_PRECISION_DECIMALS);
}

function fillRule(rule: 'nonzero' | 'evenodd'): FillRule {
  return rule === 'evenodd' ? FillRule.EvenOdd : FillRule.NonZero;
}
