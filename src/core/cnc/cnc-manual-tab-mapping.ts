import type { Polyline, Vec2 } from '../scene';
import { projectPointToPolyline } from './cnc-tab-anchors';

// The scene-object families that produce CNC contours (collect-cnc-contours).
export type CncContourSourceKind = 'imported-svg' | 'text' | 'traced-image' | 'shape';

export type CollectedCncContour = {
  readonly polyline: Polyline;
  // Which family produced this contour. Absent on legacy fixtures and direct
  // cncGroupForLayer callers, which keep the pre-provenance behavior.
  readonly sourceKind?: CncContourSourceKind;
  // Which scene object produced it. A V-carve layer resolves one text object's
  // own glyphs with non-zero fill before pooling (ADR-286), and that needs
  // object identity, not just the family. Absent on the same legacy callers,
  // which then get no grouping.
  readonly objectId?: string;
  // Converted font paths keep their own nonzero winding without changing
  // their source family or the centreline used by line/engrave operations.
  readonly fillRule?: 'nonzero' | 'evenodd';
  readonly manualTabPoints?: ReadonlyArray<Vec2>;
  // Drawn as open paths that an Outside or Inside profile closed into this one
  // outline (ADR-672, cnc-profile-outline-join).
  readonly joinedOutline?: true;
  // Exact closed copies merged into this contour on a filled cut, where two
  // identical outlines would enclose nothing (cnc-stacked-copies.ts).
  readonly stackedCopies?: number;
};

/**
 * Hand-placed tab centres for each closed toolpath, as perimeter fractions.
 *
 * ADR-258 Amendment 5 (CNC audit v3 N1-P3-1): an outline whose offset splits
 * into several loops puts each anchor on the ONE loop nearest it, not on every
 * loop. A loop that receives no anchor is left out, so it keeps automatic tabs
 * and its slug is not freed.
 */
export function manualTabCentersForToolpaths(
  toolpaths: ReadonlyArray<Polyline>,
  sources: ReadonlyArray<CollectedCncContour>,
): ReadonlyMap<Polyline, ReadonlyArray<number>> {
  const out = new Map<Polyline, ReadonlyArray<number>>();
  if (!sources.some((source) => source.manualTabPoints !== undefined)) return out;
  const loopsBySource = new Map<CollectedCncContour, Polyline[]>();
  for (const toolpath of toolpaths) {
    if (!toolpath.closed) continue;
    const source = closestSourceContour(toolpath, sources);
    if (source?.manualTabPoints === undefined) continue;
    loopsBySource.set(source, [...(loopsBySource.get(source) ?? []), toolpath]);
  }
  for (const [source, loops] of loopsBySource) anchorOnNearestLoops(source, loops, out);
  return out;
}

function anchorOnNearestLoops(
  source: CollectedCncContour,
  loops: ReadonlyArray<Polyline>,
  out: Map<Polyline, ReadonlyArray<number>>,
): void {
  const centers = new Map<Polyline, number[]>(loops.map((loop) => [loop, []]));
  for (const point of source.manualTabPoints ?? []) {
    const nearest = nearestLoop(loops, point);
    if (nearest !== null) centers.get(nearest.loop)?.push(nearest.pathT);
  }
  for (const [loop, fractions] of centers) {
    if (fractions.length > 0) out.set(loop, fractions);
  }
}

/**
 * ADR-258 Amendment 5 (N1-P3-1): when one outline's offset splits into several
 * loops, "Tabs per shape" is shared between them by perimeter, at least one
 * each, instead of every loop taking the full count. Only loops that share a
 * source with another loop appear in the result.
 */
export function splitLoopTabCounts(
  toolpaths: ReadonlyArray<Polyline>,
  sources: ReadonlyArray<CollectedCncContour>,
  tabsPerShape: number,
): ReadonlyMap<Polyline, number> {
  const closed = toolpaths.filter((toolpath) => toolpath.closed);
  const closedSources = sources.filter((source) => source.polyline.closed);
  const out = new Map<Polyline, number>();
  // Without more loops than outlines nothing split; this keeps the common case
  // from projecting every loop onto every outline.
  if (closed.length <= closedSources.length || closedSources.length === 0) return out;
  const loopsBySource = new Map<CollectedCncContour, Polyline[]>();
  for (const toolpath of closed) {
    const source = closestSourceContour(toolpath, closedSources);
    if (source !== null)
      loopsBySource.set(source, [...(loopsBySource.get(source) ?? []), toolpath]);
  }
  const count = Math.max(1, Math.floor(tabsPerShape));
  for (const loops of loopsBySource.values()) {
    if (loops.length < 2) continue;
    const perimeters = loops.map(perimeterOf);
    const total = perimeters.reduce((sum, value) => sum + value, 0);
    loops.forEach((loop, index) => {
      const share = total > 0 ? ((perimeters[index] as number) * count) / total : 1;
      out.set(loop, Math.max(1, Math.round(share)));
    });
  }
  return out;
}

function nearestLoop(
  loops: ReadonlyArray<Polyline>,
  point: Vec2,
): { readonly loop: Polyline; readonly pathT: number } | null {
  let best: { loop: Polyline; pathT: number; distanceSq: number } | null = null;
  for (const loop of loops) {
    const projection = projectPointToPolyline(loop, point);
    if (projection === null) continue;
    if (best === null || projection.distanceSq < best.distanceSq) {
      best = { loop, pathT: projection.pathT, distanceSq: projection.distanceSq };
    }
  }
  return best;
}

function closestSourceContour(
  toolpath: Polyline,
  sources: ReadonlyArray<CollectedCncContour>,
): CollectedCncContour | null {
  let best: { readonly source: CollectedCncContour; readonly distanceSq: number } | null = null;
  for (const source of sources) {
    const distanceSq = contourDistanceSq(toolpath, source.polyline);
    if (best === null || distanceSq < best.distanceSq) best = { source, distanceSq };
  }
  return best?.source ?? null;
}

function contourDistanceSq(toolpath: Polyline, source: Polyline): number {
  let distanceSq = Number.POSITIVE_INFINITY;
  const stride = Math.max(1, Math.floor(toolpath.points.length / 16));
  for (let index = 0; index < toolpath.points.length; index += stride) {
    const point = toolpath.points[index];
    if (point === undefined) continue;
    const projection = projectPointToPolyline(source, point);
    if (projection !== null) distanceSq = Math.min(distanceSq, projection.distanceSq);
  }
  return distanceSq;
}

function perimeterOf(polyline: Polyline): number {
  let total = 0;
  const points = polyline.points;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index] as Vec2;
    const b = points[(index + 1) % points.length] as Vec2;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
