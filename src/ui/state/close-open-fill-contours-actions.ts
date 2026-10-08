import { closeOpenPaths } from '../../core/geometry/path-direction-edits';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import {
  CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM,
  isCloseableOpenFillPolyline,
  openFillContours,
  type OpenFillContourGroup,
} from '../../core/job/open-fill-contours';
import { type ColoredPath, type Project, type SceneObject, type Transform } from '../../core/scene';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
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
  toleranceMm = CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM,
): CloseOpenFillContoursMutation | EmptyMutation {
  if (!Number.isFinite(toleranceMm) || toleranceMm <= 0) return {};
  const selected = new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
  if (selected.size === 0) return {};
  const groupsByObject = new Map<string, OpenFillContourGroup[]>();
  for (const group of openFillContours(state.project.scene, selected)) {
    const groups = groupsByObject.get(group.object.id) ?? [];
    groups.push(group);
    groupsByObject.set(group.object.id, groups);
  }

  let changed = false;
  const objects = state.project.scene.objects.map((object) => {
    const groups = groupsByObject.get(object.id);
    if (groups === undefined || object.locked === true) return object;
    const next = closeObjectFillContours(object, groups, toleranceMm);
    if (next !== object) changed = true;
    return next;
  });
  if (!changed) return {};

  return {
    project: { ...state.project, scene: { ...state.project.scene, objects } },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function closeObjectFillContours(
  object: SceneObject,
  groups: ReadonlyArray<OpenFillContourGroup>,
  toleranceMm: number,
): SceneObject {
  if (isBooleanCompoundObject(object) || !('paths' in object)) return object;
  const paths = closeFillPaths(object.paths, groups, object.transform, toleranceMm);
  if (paths === object.paths) return object;
  return object.kind === 'shape'
    ? (synchronizePolylineShapeGeometry(object, paths, object.bounds) ?? object)
    : { ...object, paths };
}

function closeFillPaths(
  paths: ReadonlyArray<ColoredPath>,
  groups: ReadonlyArray<OpenFillContourGroup>,
  transform: Transform,
  toleranceMm: number,
): ReadonlyArray<ColoredPath> {
  const groupsByPath = new Map(groups.map((group) => [group.pathIndex, group]));
  let changed = false;
  const nextPaths = paths.map((path, pathIndex) => {
    const group = groupsByPath.get(pathIndex);
    if (group === undefined || !group.repairable) return path;
    const canonical = new Map(
      group.contourIndexes.map((index, position) => [index, group.polylines[position]]),
    );
    const result = closeOpenPaths([path], transform, (_polyline, index) => {
      const contour = canonical.get(index);
      return contour !== undefined && isCloseableOpenFillPolyline(contour, transform, toleranceMm);
    });
    if (result.closed === 0) return path;
    changed = true;
    return result.paths[0] ?? path;
  });
  return changed ? nextPaths : paths;
}
