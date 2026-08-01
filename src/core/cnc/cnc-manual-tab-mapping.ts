import type { Polyline, Vec2 } from '../scene';
import { projectPointToPolyline } from './cnc-tab-anchors';

// The scene-object families that produce CNC contours (collect-cnc-contours).
export type CncContourSourceKind = 'imported-svg' | 'text' | 'traced-image' | 'shape';

export type CollectedCncContour = {
  readonly polyline: Polyline;
  // Which family produced this contour. Absent on legacy fixtures and direct
  // cncGroupForLayer callers, which keep the pre-provenance behavior.
  readonly sourceKind?: CncContourSourceKind;
  readonly manualTabPoints?: ReadonlyArray<Vec2>;
};

export function manualTabCentersForToolpaths(
  toolpaths: ReadonlyArray<Polyline>,
  sources: ReadonlyArray<CollectedCncContour>,
): ReadonlyMap<Polyline, ReadonlyArray<number>> {
  const out = new Map<Polyline, ReadonlyArray<number>>();
  if (!sources.some((source) => source.manualTabPoints !== undefined)) return out;
  for (const toolpath of toolpaths) {
    if (!toolpath.closed) continue;
    const source = closestSourceContour(toolpath, sources);
    if (source?.manualTabPoints === undefined) continue;
    const centers = source.manualTabPoints
      .map((point) => projectPointToPolyline(toolpath, point)?.pathT)
      .filter((pathT): pathT is number => pathT !== undefined);
    if (centers.length > 0) out.set(toolpath, centers);
  }
  return out;
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
