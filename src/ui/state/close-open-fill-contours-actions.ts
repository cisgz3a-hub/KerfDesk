import {
  assertNever,
  pathUsesOperation,
  type ColoredPath,
  type Layer,
  type Project,
  type SceneObject,
  type ShapeObject,
  type Transform,
} from '../../core/scene';
import {
  CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM,
  isCloseableOpenFillPolyline,
} from '../common/fill-diagnostics';
import { pushUndo, type StateSlice } from './scene-mutations';

export type CloseOpenFillContoursActions = {
  readonly closeSelectedOpenFillContours: () => void;
  readonly closeSelectedOpenFillContoursWithTolerance: (toleranceMm: number) => void;
};

type CloseOpenFillContoursState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type CloseOpenFillContoursMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type EmptyMutation = Record<string, never>;

type CloseOpenFillContoursSet = (
  fn: (state: CloseOpenFillContoursState) => CloseOpenFillContoursMutation | EmptyMutation,
) => void;

export function closeOpenFillContoursActions(
  set: CloseOpenFillContoursSet,
): CloseOpenFillContoursActions {
  return {
    closeSelectedOpenFillContours: () => set((state) => closeOpenFillContoursMutation(state)),
    closeSelectedOpenFillContoursWithTolerance: (toleranceMm) =>
      set((state) => closeOpenFillContoursMutation(state, toleranceMm)),
  };
}

function closeOpenFillContoursMutation(
  state: CloseOpenFillContoursState,
  toleranceMm?: number,
): CloseOpenFillContoursMutation | EmptyMutation {
  const tolerance = normalizedTolerance(toleranceMm);
  if (tolerance === null) return {};
  const selectedIds = selectedIdsForState(state);
  if (selectedIds.size === 0) return {};
  const fillOperations = outputFillOperations(state.project);
  if (fillOperations.length === 0) return {};

  let changed = false;
  const objects = state.project.scene.objects.map((object) => {
    if (!selectedIds.has(object.id) || object.locked === true) return object;
    const next = closeObjectFillContours(object, fillOperations, tolerance);
    if (next !== object) changed = true;
    return next;
  });
  if (!changed) return {};

  return {
    project: {
      ...state.project,
      scene: { ...state.project.scene, objects },
    },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function closeObjectFillContours(
  object: SceneObject,
  fillOperations: ReadonlyArray<Layer>,
  toleranceMm: number,
): SceneObject {
  switch (object.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image': {
      const paths = closeFillPaths(
        object,
        object.paths,
        fillOperations,
        object.transform,
        toleranceMm,
      );
      return paths === object.paths ? object : { ...object, paths };
    }
    case 'shape':
      return closeShapeFillContours(object, fillOperations, toleranceMm);
    case 'raster-image':
    case 'relief':
      return object;
    default:
      return assertNever(object, 'SceneObject');
  }
}

function closeShapeFillContours(
  object: ShapeObject,
  fillOperations: ReadonlyArray<Layer>,
  toleranceMm: number,
): ShapeObject {
  const paths = closeFillPaths(object, object.paths, fillOperations, object.transform, toleranceMm);
  if (paths === object.paths) return object;
  return {
    ...object,
    paths,
    spec: object.spec.kind === 'polyline' ? { ...object.spec, closed: true } : object.spec,
  };
}

function closeFillPaths(
  object: Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>,
  paths: ReadonlyArray<ColoredPath>,
  fillOperations: ReadonlyArray<Layer>,
  transform: Transform,
  toleranceMm: number,
): ReadonlyArray<ColoredPath> {
  let changed = false;
  const nextPaths = paths.map((path) => {
    if (!fillOperations.some((operation) => pathUsesOperation(object, path, operation)))
      return path;
    let pathChanged = false;
    const polylines = path.polylines.map((polyline) => {
      if (!isCloseableOpenFillPolyline(polyline, transform, toleranceMm)) return polyline;
      changed = true;
      pathChanged = true;
      return { ...polyline, closed: true };
    });
    return pathChanged ? { ...path, polylines } : path;
  });
  return changed ? nextPaths : paths;
}

function normalizedTolerance(toleranceMm: number | undefined): number | null {
  if (toleranceMm === undefined) return CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM;
  if (!Number.isFinite(toleranceMm) || toleranceMm <= 0) return null;
  return toleranceMm;
}

function selectedIdsForState(state: CloseOpenFillContoursState): ReadonlySet<string> {
  return new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
}

function outputFillOperations(project: Project): ReadonlyArray<Layer> {
  return project.scene.layers.filter((operation) => operation.output && operation.mode === 'fill');
}
