import { compilationPolylines } from '../../core/job/compilation-polylines';
import type { ColoredPath, Polyline, Transform } from '../../core/scene';
import { preserveContourTopologySteps } from '../../core/trace/contour-topology';
import { runTraceSteps } from '../../core/trace/trace-steps';

type Boundary = {
  readonly pathIndex: number;
  readonly subpathIndex: number;
  readonly source: Polyline;
  readonly polyline: Polyline;
  readonly simplified: boolean;
};

/** A per-outline distance bound cannot preserve a narrow gap or hole. Check
 * all closed boundaries together against the geometry compile reads, and
 * undo only conflicting simplifications. Fitted canonical curves stay intact. */
export function preserveLaserTraceTopology(
  source: ReadonlyArray<ColoredPath>,
  candidates: ColoredPath[],
  placement: Transform,
): ColoredPath[] {
  if (candidates.every((candidate, index) => candidate === source[index])) return candidates;
  const boundaries = closedBoundaries(source, candidates, placement);
  if (!boundaries.some((boundary) => boundary.simplified)) return candidates;
  const retained = runTraceSteps(
    preserveContourTopologySteps(
      boundaries.map((boundary) => ({
        source: boundary.source,
        polyline: boundary.polyline,
        baseline: boundary.source,
        refine: () => boundary.source,
      })),
    ),
  );
  const fallbacks = new Map<number, Map<number, Polyline>>();
  boundaries.forEach((boundary, index) => {
    if (!boundary.simplified || retained[index] === boundary.polyline) return;
    let subpaths = fallbacks.get(boundary.pathIndex);
    if (subpaths === undefined) {
      subpaths = new Map();
      fallbacks.set(boundary.pathIndex, subpaths);
    }
    subpaths.set(boundary.subpathIndex, boundary.source);
  });
  return candidates.map((candidate, pathIndex) => {
    const subpaths = fallbacks.get(pathIndex);
    const original = source[pathIndex];
    if (subpaths === undefined || original === undefined) return candidate;
    return {
      ...candidate,
      polylines: candidate.polylines.map((polyline, index) => subpaths.get(index) ?? polyline),
      ...(candidate.curves === undefined
        ? {}
        : {
            curves: candidate.curves.map((curve, index) =>
              subpaths.has(index) ? (original.curves?.[index] ?? curve) : curve,
            ),
          }),
    };
  });
}

function closedBoundaries(
  source: ReadonlyArray<ColoredPath>,
  candidates: ReadonlyArray<ColoredPath>,
  placement: Transform,
): Boundary[] {
  const boundaries: Boundary[] = [];
  candidates.forEach((candidate, pathIndex) => {
    const original = source[pathIndex];
    if (original === undefined) return;
    const before = compilationPolylines(original, placement);
    const after = candidate === original ? before : compilationPolylines(candidate, placement);
    after.forEach((polyline, subpathIndex) => {
      const previous = before[subpathIndex];
      if (previous === undefined || !previous.closed || !polyline.closed) return;
      const curve = original.curves?.[subpathIndex];
      boundaries.push({
        pathIndex,
        subpathIndex,
        source: previous,
        polyline,
        // Updating only a fitted curve's compatibility samples changes no
        // output, so it is a fixed neighbour rather than a simplification.
        simplified:
          curve === undefined
            ? candidate.polylines[subpathIndex] !== original.polylines[subpathIndex]
            : candidate.curves?.[subpathIndex] !== curve,
      });
    });
  });
  return boundaries;
}
