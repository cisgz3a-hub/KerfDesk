// Click-placed laser Line tabs (ADR-494, LBG-C05): the store edits behind the
// laser tab tool. Each add, remove or clear is one undo step; a drag moves a
// tab live and the workspace's interaction snapshot makes it one step too.

import { projectLaserTabAnchor } from '../../core/job/laser-tab-anchors';
import type { Project, SceneObject, Vec2 } from '../../core/scene';
import type { LaserTabAnchor } from '../../core/scene/scene-object';
import { pushUndo } from './scene-mutations';

type LaserTabState = {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: boolean;
};

type Setter = (fn: (state: LaserTabState) => Partial<LaserTabState>) => void;

export type LaserTabActions = {
  /** Places a tab at the point of the selected object's closed `layerColor`
   * contours nearest `scenePoint`, when that point is within `toleranceMm`.
   * Returns whether a tab was placed. */
  readonly addSelectedLaserTabAnchor: (
    layerColor: string,
    scenePoint: Vec2,
    toleranceMm: number,
  ) => boolean;
  readonly removeSelectedLaserTabAnchor: (anchorIndex: number, layerColor: string) => void;
  readonly setSelectedLaserTabAnchorDuringInteraction: (
    anchorIndex: number,
    layerColor: string,
    scenePoint: Vec2,
  ) => void;
  /** Back to automatic tabs on the selected object's `layerColor` contours. */
  readonly clearSelectedLaserTabAnchors: (layerColor: string) => void;
};

export function laserTabActions(set: Setter): LaserTabActions {
  return {
    addSelectedLaserTabAnchor: (layerColor, scenePoint, toleranceMm) => {
      let added = false;
      set((state) =>
        commitSelected(state, (object) => {
          const next = withAddedAnchor(object, layerColor, scenePoint, toleranceMm);
          added = next !== object;
          return next;
        }),
      );
      return added;
    },
    removeSelectedLaserTabAnchor: (anchorIndex, layerColor) =>
      set((state) =>
        commitSelected(state, (object) =>
          withAnchors(
            object,
            (anchors) => anchors.filter((_anchor, index) => index !== anchorIndex),
            (anchor, index) => index === anchorIndex && anchor.layerColor === layerColor,
          ),
        ),
      ),
    setSelectedLaserTabAnchorDuringInteraction: (anchorIndex, layerColor, scenePoint) =>
      set((state) => moveAnchor(state, anchorIndex, layerColor, scenePoint)),
    clearSelectedLaserTabAnchors: (layerColor) =>
      set((state) =>
        commitSelected(state, (object) =>
          withAnchors(
            object,
            (anchors) => anchors.filter((anchor) => anchor.layerColor !== layerColor),
            (anchor) => anchor.layerColor === layerColor,
          ),
        ),
      ),
  };
}

/** The one unlocked selected object, or null for none, several or locked. */
export function editableLaserTabObject(state: LaserTabState): SceneObject | null {
  if (state.selectedObjectId === null || state.additionalSelectedIds.size > 0) return null;
  const object = state.project.scene.objects.find((item) => item.id === state.selectedObjectId);
  return object === undefined || object.locked === true || !('paths' in object) ? null : object;
}

function commitSelected(
  state: LaserTabState,
  mutate: (object: SceneObject) => SceneObject,
): Partial<LaserTabState> {
  const target = editableLaserTabObject(state);
  if (target === null) return {};
  const next = mutate(target);
  if (next === target) return {};
  return {
    project: replaceObject(state.project, next),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function withAddedAnchor(
  object: SceneObject,
  layerColor: string,
  scenePoint: Vec2,
  toleranceMm: number,
): SceneObject {
  if (!Number.isFinite(scenePoint.x) || !Number.isFinite(scenePoint.y)) return object;
  const projected = projectLaserTabAnchor(object, layerColor, scenePoint);
  if (projected === null || projected.distanceMm > toleranceMm) return object;
  return { ...object, laserTabAnchors: [...(object.laserTabAnchors ?? []), projected.anchor] };
}

// Drops the field once no anchor is left, so the object reads as untouched.
function withAnchors(
  object: SceneObject,
  keep: (anchors: ReadonlyArray<LaserTabAnchor>) => ReadonlyArray<LaserTabAnchor>,
  affects: (anchor: LaserTabAnchor, index: number) => boolean,
): SceneObject {
  const anchors = object.laserTabAnchors;
  if (anchors === undefined || !anchors.some(affects)) return object;
  const remaining = keep(anchors);
  if (remaining.length > 0) return { ...object, laserTabAnchors: remaining };
  const { laserTabAnchors: _removed, ...rest } = object;
  return rest;
}

function moveAnchor(
  state: LaserTabState,
  anchorIndex: number,
  layerColor: string,
  scenePoint: Vec2,
): Partial<LaserTabState> {
  const object = editableLaserTabObject(state);
  if (object === null || !Number.isFinite(scenePoint.x) || !Number.isFinite(scenePoint.y)) {
    return {};
  }
  const current = object.laserTabAnchors?.[anchorIndex];
  if (current === undefined || current.layerColor !== layerColor) return {};
  const projected = projectLaserTabAnchor(object, layerColor, scenePoint);
  if (projected === null || sameAnchor(projected.anchor, current)) return {};
  const laserTabAnchors = [...(object.laserTabAnchors ?? [])];
  laserTabAnchors[anchorIndex] = projected.anchor;
  return { project: replaceObject(state.project, { ...object, laserTabAnchors }), dirty: true };
}

function sameAnchor(left: LaserTabAnchor, right: LaserTabAnchor): boolean {
  return (
    left.layerColor === right.layerColor &&
    left.pathIndex === right.pathIndex &&
    left.polylineIndex === right.polylineIndex &&
    left.pathT === right.pathT
  );
}

function replaceObject(project: Project, next: SceneObject): Project {
  const objects = project.scene.objects.map((object) => (object.id === next.id ? next : object));
  return { ...project, scene: { ...project.scene, objects } };
}
