// Continue an existing path with the pen (LightBurn Draw Lines: start on an
// open endpoint to extend that shape). The drawn stretch is carried exactly
// into the object's coordinates, starts exactly on the endpoint and is joined
// onto it; ending on the contour's other endpoint closes it. One undo step.

import { bakeCurves, invertAffine, transformAffine } from '../../core/geometry/shear-bake';
import {
  curveEndpointJoin,
  curveNodeCount,
  curveNodePoint,
  polylineToCurveSubpath,
  type CurveSubpath,
  type Transform,
} from '../../core/scene';
import { isPathEditable } from './path-cleanup-actions';
import { materializeCurves } from './path-node-curve-command-actions';
import { boundsForPaths } from './path-node-edit-geometry';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import type { PenContinuation } from './ui-store';

export type PenContinueActions = {
  /** Joins the drawn world-space stretch onto `from`; false when it cannot. */
  readonly extendPathContour: (
    from: PenContinuation,
    drawn: CurveSubpath,
    close: boolean,
  ) => boolean;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function penContinueActions(set: Setter): PenContinueActions {
  return {
    extendPathContour: (from, drawn, close) => {
      let done = false;
      set((state) => {
        const next = extendMutation(state, from, drawn, close);
        done = next !== null;
        return next ?? state;
      });
      return done;
    },
  };
}

function extendMutation(
  state: AppState,
  from: PenContinuation,
  drawn: CurveSubpath,
  close: boolean,
): Partial<AppState> | null {
  const object = state.project.scene.objects.find((candidate) => candidate.id === from.objectId);
  if (object === undefined || object.locked === true || !isPathEditable(object)) return null;
  const path = object.paths[from.pathIndex];
  const curves =
    path === undefined ? [] : (path.curves ?? path.polylines.map(polylineToCurveSubpath));
  const contour = extendedContour(
    object.transform,
    curves[from.curveIndex],
    from.node,
    drawn,
    close,
  );
  const nextPath =
    path === undefined || contour === null
      ? null
      : materializeCurves(
          path,
          curves.map((curve, index) => (index === from.curveIndex ? contour : curve)),
        );
  if (nextPath === null) return null;
  const paths = object.paths.map((entry, index) => (index === from.pathIndex ? nextPath : entry));
  const bounds = boundsForPaths(paths);
  const updated =
    object.kind === 'shape'
      ? synchronizePolylineShapeGeometry(object, paths, bounds)
      : { ...object, paths, bounds };
  if (updated === null) return null;
  return {
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((candidate) =>
          candidate.id === object.id ? updated : candidate,
        ),
      },
    },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    selectedPathNode: null,
    selectedPathNodes: [],
  };
}

// The existing contour with the drawn world-space stretch joined at `node`.
function extendedContour(
  transform: Transform,
  existing: CurveSubpath | undefined,
  node: number,
  drawn: CurveSubpath,
  close: boolean,
): CurveSubpath | null {
  const inverse = invertAffine(transformAffine(transform));
  const anchor = existing === undefined ? null : curveNodePoint(existing, node);
  if (existing === undefined || anchor === null || inverse === null) return null;
  const [local] = bakeCurves([{ ...drawn, closed: false }], inverse);
  if (local === undefined) return null;
  const joined = curveEndpointJoin.join(existing, node, { ...local, start: anchor }, 0);
  if (joined.kind !== 'ok') return null;
  return close ? closedOnStart(joined.curve) : joined.curve;
}

// The drawn stretch ended on the contour's other end: meet it exactly and close.
function closedOnStart(curve: CurveSubpath): CurveSubpath | null {
  const last = curveNodeCount(curve) - 1;
  const segments = curve.segments.map((segment, index) =>
    index === curve.segments.length - 1 ? { ...segment, to: curve.start } : segment,
  );
  const result = curveEndpointJoin.close({ ...curve, segments }, 0, last);
  return result.kind === 'ok' ? result.curve : null;
}
