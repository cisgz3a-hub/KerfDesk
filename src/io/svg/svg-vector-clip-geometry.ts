// A clipped vector element imports as the part its clip paths keep (ADR-358
// Amendment 2). Per element:
//   1. No clip: unchanged.
//   2. A convex clip that provably hides nothing (Amendment 1): unchanged, with
//      its native curves.
//   3. Otherwise its geometry, flattened at the machine curve tolerance, is
//      intersected with the clip region. Filled artwork is intersected as
//      polygons under its own fill rule; stroked artwork, which the laser cuts
//      as lines, keeps the stretches of each line inside the region. Geometry
//      the region keeps whole still imports unchanged with its native curves:
//      a whole filled element, or each whole line of a stroked one.
// Each distinct chain of clip references resolves, and builds its region, once
// per import, however many elements share it.

import { polylineToCurveSubpath, type CurveSubpath, type Polyline } from '../../core/scene';
import type { SubPath } from './parse-path-d';
import {
  intersectFilledRings,
  machineDocumentPoints,
  svgClipRegion,
  svgClipRegionAround,
  type SvgClipRegion,
} from './svg-clip-region';
import {
  resolveSvgClip,
  svgClipReferenceKey,
  type ResolvedSvgClip,
  type SvgClipResolver,
} from './svg-clip-resolve';
import { applySvgMatrix, transformSvgCurveSubpath, type SvgMatrix } from './svg-curve-transform';
import type { PresentationState, SvgClipReference } from './svg-presentation';
import { createRegionLineClipper } from './svg-region-line-clip';
import {
  convexClipOutline,
  outlinesKeepWholeGeometry,
  vectorContainmentPoints,
  type ConvexClipOutline,
} from './svg-vector-clip';

/** An element's geometry in document millimetres; curves[i] belongs to polylines[i]. */
export type SvgVectorGeometry = {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly curves: ReadonlyArray<CurveSubpath>;
};

export type SvgVectorClipper = (
  subpaths: ReadonlyArray<SubPath>,
  state: PresentationState,
  mode: 'fill' | 'line',
) => SvgVectorGeometry;

type ClipChain = {
  readonly resolved: ReadonlyArray<ResolvedSvgClip>;
  readonly outlines: ReadonlyArray<ConvexClipOutline | null>;
  region?: SvgClipRegion;
};

export function createSvgVectorClipper(resolver: SvgClipResolver): SvgVectorClipper {
  // Descendants of a clipped group share its reference list; separate
  // elements naming the same clip in the same space share a key.
  const byList = new WeakMap<ReadonlyArray<SvgClipReference>, ClipChain>();
  const byKey = new Map<string, ClipChain>();
  const chainFor = (clips: ReadonlyArray<SvgClipReference>): ClipChain => {
    const listed = byList.get(clips);
    if (listed !== undefined) return listed;
    const key = clips.map((reference) => svgClipReferenceKey(reference, resolver)).join(';');
    let chain = byKey.get(key);
    if (chain === undefined) {
      const resolved = clips.map((reference) => resolveSvgClip(reference, resolver));
      chain = { resolved, outlines: resolved.map(convexClipOutline) };
      byKey.set(key, chain);
    }
    byList.set(clips, chain);
    return chain;
  };
  return (subpaths, state, mode) => {
    const matrix = state.transform;
    if (state.clips.length === 0) return unclippedGeometry(subpaths, matrix);
    const chain = chainFor(state.clips);
    if (outlinesKeepWholeGeometry(chain.outlines, vectorContainmentPoints(subpaths, matrix)))
      return unclippedGeometry(subpaths, matrix);
    chain.region ??= svgClipRegion(chain.resolved);
    return mode === 'fill'
      ? clippedFill(subpaths, matrix, state.fillRule ?? 'nonzero', chain.region)
      : clippedLines(subpaths, matrix, chain.region);
  };
}

/** Exactly what an unclipped element imports: authored samples and native curves. */
function unclippedGeometry(subpaths: ReadonlyArray<SubPath>, matrix: SvgMatrix): SvgVectorGeometry {
  const polylines = subpaths.map((subpath) => ({
    points: subpath.points.map((point) => applySvgMatrix(matrix, point)),
    closed: subpath.closed,
  }));
  const curves = subpaths.map((subpath, index) =>
    subpath.curve === undefined
      ? polylineToCurveSubpath(polylines[index] ?? { points: [], closed: subpath.closed })
      : transformSvgCurveSubpath(subpath.curve, matrix),
  );
  return { polylines, curves };
}

// SVG fills close every subpath implicitly, so each one is a ring here.
function clippedFill(
  subpaths: ReadonlyArray<SubPath>,
  matrix: SvgMatrix,
  rule: 'nonzero' | 'evenodd',
  region: SvgClipRegion,
): SvgVectorGeometry {
  const rings = subpaths
    .map((subpath) => machineDocumentPoints(subpath, matrix))
    .filter((ring) => ring.length >= 3);
  const kept = intersectFilledRings(rings, rule, region);
  if (kept === null) return unclippedGeometry(subpaths, matrix);
  const polylines = kept.map((ring) => {
    const points = ring.map((point) => ({ x: point.x, y: point.y }));
    const first = points[0];
    return { points: first === undefined ? points : [...points, first], closed: true };
  });
  return { polylines, curves: polylines.map(polylineToCurveSubpath) };
}

function clippedLines(
  subpaths: ReadonlyArray<SubPath>,
  matrix: SvgMatrix,
  region: SvgClipRegion,
): SvgVectorGeometry {
  const lines = subpaths.map((subpath) => machineDocumentPoints(subpath, matrix));
  const clipLine = createRegionLineClipper(svgClipRegionAround(region, lines));
  const polylines: Polyline[] = [];
  const curves: CurveSubpath[] = [];
  for (const [index, subpath] of subpaths.entries()) {
    const clipped = clipLine(lines[index] ?? [], subpath.closed);
    if (clipped.kind === 'inside') {
      const whole = unclippedGeometry([subpath], matrix);
      polylines.push(...whole.polylines);
      curves.push(...whole.curves);
      continue;
    }
    for (const piece of clipped.pieces) {
      polylines.push(piece);
      curves.push(polylineToCurveSubpath(piece));
    }
  }
  return { polylines, curves };
}
