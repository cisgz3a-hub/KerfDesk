import {
  differenceD,
  EndType,
  FillRule,
  inflatePathsD,
  intersectD,
  JoinType,
  unionD,
  type PathsD,
} from 'clipper2-ts';
import { pathDToPolyline, polylineToPathD, tryVectorOp } from '../geometry/vector-path-tools';
import type { Polyline } from '../scene';

export type Cnc2dStockEvidence = {
  readonly sourceKind: 'planned-rough-stage';
  readonly previousToolId: string;
  readonly previousToolDiameterMm: number;
  readonly depthMm: number;
  readonly toleranceMm: number;
  readonly sourceSignature: string;
  readonly removedAreaMm2: number;
  readonly residualAreaMm2: number;
};
export type Cnc2dStockResult =
  | {
      readonly ok: true;
      readonly residualContours: ReadonlyArray<Polyline>;
      readonly evidence: Cnc2dStockEvidence;
    }
  | { readonly ok: false; readonly reason: string };

/** Constant-Z end-mill routes only. Radius shrinks by tolerance so uncertain stock remains. */
export function predictCnc2dStock(
  sourceContours: ReadonlyArray<Polyline>,
  cutPaths: ReadonlyArray<Polyline>,
  tool: { readonly id: string; readonly diameterMm: number },
  depthMm: number,
  toleranceMm: number,
): Cnc2dStockResult {
  const issue = stockInputIssue(sourceContours, cutPaths, tool.diameterMm, depthMm, toleranceMm);
  if (issue !== null) return { ok: false, reason: issue };
  const result = tryVectorOp(() => {
    const source = unionD(sourceContours.map(polylineToPathD), [], FillRule.EvenOdd, 3);
    const routes = cutPaths.map(closedRoutePoints);
    const sweeps =
      routes.length === 0
        ? []
        : inflatePathsD(
            routes,
            tool.diameterMm / 2 - toleranceMm,
            JoinType.Round,
            EndType.Round,
            2,
            3,
            0.001,
          );
    const removed = intersectD(
      source,
      unionD(sweeps, [], FillRule.NonZero, 3),
      FillRule.NonZero,
      3,
    );
    const residual = differenceD(source, removed, FillRule.NonZero, 3);
    return { removed, residual };
  });
  if (result.kind === 'error')
    return {
      ok: false,
      reason: 'Previous-route stock geometry failed; stock coverage is unknown.',
    };
  return {
    ok: true,
    residualContours: result.value.residual.map(pathDToPolyline),
    evidence: {
      sourceKind: 'planned-rough-stage',
      previousToolId: tool.id,
      previousToolDiameterMm: tool.diameterMm,
      depthMm,
      toleranceMm,
      sourceSignature: stockSignature([sourceContours, cutPaths, tool, depthMm, toleranceMm]),
      removedAreaMm2: area(result.value.removed),
      residualAreaMm2: area(result.value.residual),
    },
  };
}

function stockInputIssue(
  source: ReadonlyArray<Polyline>,
  routes: ReadonlyArray<Polyline>,
  diameter: number,
  depth: number,
  tolerance: number,
): string | null {
  if (
    ![diameter, depth, tolerance].every(Number.isFinite) ||
    diameter <= 0 ||
    depth <= 0 ||
    tolerance < 0.002 ||
    tolerance >= diameter / 2
  )
    return 'Previous-route stock needs finite cutter, depth and conservative tolerance.';
  if (source.length === 0 || source.some((path) => !path.closed || path.points.length < 3))
    return 'Previous-route stock requires closed pocket source contours.';
  if (routes.some((path) => path.points.length < 2))
    return 'Previous-route stock contains a route that cannot emit; coverage is unknown.';
  const allPaths = [...source, ...routes];
  if (
    allPaths.length > 4096 ||
    allPaths.reduce((count, path) => count + path.points.length, 0) > 200000
  )
    return 'Previous-route stock exceeds the geometry budget; coverage is unknown.';
  return allPaths.some((path) =>
    path.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)),
  )
    ? 'Previous-route stock contains nonfinite points; coverage is unknown.'
    : null;
}

function area(paths: PathsD): number {
  let sum = 0;
  for (const path of paths)
    for (let index = 0; index < path.length; index += 1) {
      const a = path[index],
        b = path[(index + 1) % path.length];
      if (a !== undefined && b !== undefined) sum += a.x * b.y - b.x * a.y;
    }
  return Math.abs(sum / 2);
}

function stockSignature(values: unknown): string {
  let hash = 2166136261;
  const text = JSON.stringify(values);
  for (let index = 0; index < text.length; index += 1)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `2d-stock-v1-${(hash >>> 0).toString(16)}`;
}

function closedRoutePoints(path: Polyline): Array<{ x: number; y: number }> {
  const points = path.points.map((point) => ({ ...point }));
  const first = points[0],
    last = points[points.length - 1];
  if (
    path.closed &&
    first !== undefined &&
    last !== undefined &&
    (first.x !== last.x || first.y !== last.y)
  )
    points.push(first);
  return points;
}
