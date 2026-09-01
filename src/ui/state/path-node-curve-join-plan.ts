import {
  curveEndpointJoin,
  flattenCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { boundsForPaths } from './path-node-edit-geometry';
import type { PathNodeRef } from './path-node-edit-actions';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';

type UnchangedCurveJoinPlan = { readonly kind: 'unchanged'; readonly message: string };

type CurveJoinPlan =
  | {
      readonly kind: 'success';
      readonly outcome: 'joined' | 'closed';
      readonly message: string;
      readonly object: SceneObject;
    }
  | UnchangedCurveJoinPlan;

type CurveCommandObject = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;

type SelectedJoinAnchors = {
  readonly kind: 'selected';
  readonly left: PathNodeRef;
  readonly right: PathNodeRef;
};

type ReadyJoinContext = {
  readonly kind: 'ready';
  readonly object: CurveCommandObject;
  readonly pathIndex: number;
  readonly path: ColoredPath & { readonly curves: ReadonlyArray<CurveSubpath> };
  readonly firstRef: PathNodeRef;
  readonly secondRef: PathNodeRef;
  readonly first: CurveSubpath;
  readonly second: CurveSubpath;
};

/** Builds one atomic, source-order-stable Join/Close replacement or a truthful unchanged result. */
export function planCurveNodeJoin(
  project: Project,
  refs: ReadonlyArray<PathNodeRef>,
): CurveJoinPlan {
  const selected = resolveSelectedJoinAnchors(refs);
  if (selected.kind === 'unchanged') return selected;
  const context = resolveJoinContext(project, selected);
  if (context.kind === 'unchanged') return context;
  return context.firstRef.polylineIndex === context.secondRef.polylineIndex
    ? planClose(context)
    : planDistinctJoin(context);
}

function resolveSelectedJoinAnchors(
  refs: ReadonlyArray<PathNodeRef>,
): SelectedJoinAnchors | UnchangedCurveJoinPlan {
  if (refs.length !== 2) {
    return unchanged('Select exactly two curve anchors to Join.');
  }
  const [left, right] = refs;
  if (left === undefined || right === undefined) {
    return unchanged('Select exactly two curve anchors to Join.');
  }
  if (left.objectId !== right.objectId) {
    return unchanged('Join requires both endpoints in the same artwork.');
  }
  if (left.pathIndex !== right.pathIndex) {
    return unchanged('Join requires both endpoints in the same colored path.');
  }
  return { kind: 'selected', left, right };
}

function resolveJoinContext(
  project: Project,
  selected: SelectedJoinAnchors,
): ReadyJoinContext | UnchangedCurveJoinPlan {
  const { left, right } = selected;
  const object = project.scene.objects.find((candidate) => candidate.id === left.objectId);
  if (object === undefined || !isCurveCommandObject(object)) {
    return unchanged('The selected artwork no longer supports curve editing.');
  }
  const path = object.paths[left.pathIndex];
  if (path?.curves === undefined) return unavailableAnchors();

  const [firstRef, secondRef] =
    compareSourcePosition(left, right) <= 0 ? [left, right] : [right, left];
  const first = path.curves[firstRef.polylineIndex];
  const second = path.curves[secondRef.polylineIndex];
  if (first === undefined || second === undefined) return unavailableAnchors();

  return {
    kind: 'ready',
    object,
    pathIndex: left.pathIndex,
    path: { ...path, curves: path.curves },
    firstRef,
    secondRef,
    first,
    second,
  };
}

function planClose(context: ReadyJoinContext): CurveJoinPlan {
  const result = curveEndpointJoin.close(
    context.first,
    context.firstRef.pointIndex,
    context.secondRef.pointIndex,
  );
  return result.kind === 'ok'
    ? materializePlan(
        context.object,
        context.pathIndex,
        context.path,
        replaceCurve(context.path.curves, context.firstRef, result.curve),
        'closed',
      )
    : resultMessage(result);
}

function planDistinctJoin(context: ReadyJoinContext): CurveJoinPlan {
  if (context.object.kind === 'shape') {
    return unchanged('Join cannot combine multiple subpaths in a polyline shape.');
  }
  const result = curveEndpointJoin.join(
    context.first,
    context.firstRef.pointIndex,
    context.second,
    context.secondRef.pointIndex,
  );
  if (result.kind !== 'ok') return resultMessage(result);
  const curves = context.path.curves
    .map((curve, index) => (index === context.firstRef.polylineIndex ? result.curve : curve))
    .filter((_curve, index) => index !== context.secondRef.polylineIndex);
  const object = remapTabAnchorsAfterCurveRemoval(
    context.object,
    context.pathIndex,
    context.secondRef.polylineIndex,
  );
  return materializePlan(object, context.pathIndex, context.path, curves, 'joined');
}

function remapTabAnchorsAfterCurveRemoval(
  object: CurveCommandObject,
  pathIndex: number,
  removedPolylineIndex: number,
): CurveCommandObject {
  if (object.cncTabAnchors === undefined) return object;
  let changed = false;
  const cncTabAnchors = object.cncTabAnchors.flatMap((anchor) => {
    if (anchor.pathIndex !== pathIndex || anchor.polylineIndex < removedPolylineIndex) {
      return [anchor];
    }
    changed = true;
    if (anchor.polylineIndex === removedPolylineIndex) return [];
    return [{ ...anchor, polylineIndex: anchor.polylineIndex - 1 }];
  });
  return changed ? { ...object, cncTabAnchors } : object;
}

function materializePlan(
  object: Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>,
  pathIndex: number,
  sourcePath: ColoredPath,
  curves: ReadonlyArray<CurveSubpath>,
  outcome: 'joined' | 'closed',
): CurveJoinPlan {
  const path = materializeCurves(sourcePath, curves);
  if (path === null) {
    return unchanged('Join could not materialize the selected curves; the artwork was unchanged.');
  }
  const paths = object.paths.map((candidate, index) => (index === pathIndex ? path : candidate));
  const bounds = boundsForPaths(paths);
  const updated =
    object.kind === 'shape'
      ? synchronizePolylineShapeGeometry(object, paths, bounds)
      : { ...object, paths, bounds };
  if (updated === null) {
    if (object.kind === 'shape') {
      return unchanged(
        'Join supports polyline shapes with one path and one subpath; the artwork was unchanged.',
      );
    }
    return unchanged(
      'Join could not synchronize the selected polyline shape; the artwork was unchanged.',
    );
  }
  return {
    kind: 'success',
    outcome,
    message:
      outcome === 'closed' ? 'Closed the selected open curve.' : 'Joined two open curve endpoints.',
    object: updated,
  };
}

function materializeCurves(
  path: ColoredPath,
  curves: ReadonlyArray<CurveSubpath>,
): ColoredPath | null {
  const polylines = [];
  for (const curve of curves) {
    const result = flattenCurveSubpath(curve, { toleranceMm: 0.05 });
    if (result.kind !== 'ok') return null;
    polylines.push(result.polyline);
  }
  return { ...path, curves, polylines };
}

function replaceCurve(
  curves: ReadonlyArray<CurveSubpath>,
  ref: PathNodeRef,
  curve: CurveSubpath,
): ReadonlyArray<CurveSubpath> {
  return curves.map((candidate, index) => (index === ref.polylineIndex ? curve : candidate));
}

function compareSourcePosition(a: PathNodeRef, b: PathNodeRef): number {
  return a.polylineIndex - b.polylineIndex || a.pointIndex - b.pointIndex;
}

function resultMessage(result: {
  readonly kind: 'error';
  readonly reason: 'closed-path' | 'interior-anchor' | 'invalid-anchor';
}): CurveJoinPlan {
  if (result.reason === 'closed-path') {
    return unchanged('Join requires open paths. Break a closed path before joining it.');
  }
  if (result.reason === 'interior-anchor') {
    return unchanged('Join connects open endpoints; select a start or end node.');
  }
  return unavailableAnchors();
}

function unavailableAnchors(): UnchangedCurveJoinPlan {
  return unchanged(
    'The selected curve anchors are no longer available. Select two endpoints again.',
  );
}

function unchanged(message: string): UnchangedCurveJoinPlan {
  return { kind: 'unchanged', message };
}

function isCurveCommandObject(
  object: SceneObject,
): object is Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }> {
  return (
    object.kind === 'imported-svg' ||
    object.kind === 'traced-image' ||
    (object.kind === 'shape' && object.spec.kind === 'polyline')
  );
}
