// A segment of node-edited artwork (ADR-376). `segmentIndex` counts edges the
// same way on canonical curves and legacy polylines: edge i runs from node i
// to node i + 1, and a closed path's closing edge is the last one. Canonical
// curves are indexed after writing out an implicit closing line (see
// explicitCurveSubpath), so a legacy polyline promoted to curves keeps the
// same numbering.

export type PathSegmentRef = {
  readonly objectId: string;
  readonly pathIndex: number;
  readonly polylineIndex: number;
  readonly segmentIndex: number;
};

export function pathSegmentRefsEqual(a: PathSegmentRef, b: PathSegmentRef): boolean {
  return (
    a.objectId === b.objectId &&
    a.pathIndex === b.pathIndex &&
    a.polylineIndex === b.polylineIndex &&
    a.segmentIndex === b.segmentIndex
  );
}
