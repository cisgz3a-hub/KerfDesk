import { projectCncTabAnchor, seedCncTabAnchors } from '../../core/cnc';
import { type Project, type SceneObject, type Vec2 } from '../../core/scene';
import { pushUndo } from './scene-mutations';

type CncTabState = {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: boolean;
};

type Setter = (fn: (state: CncTabState) => Partial<CncTabState>) => void;

export type CncTabActions = {
  readonly seedSelectedCncTabAnchors: (layerColor: string, count: number) => void;
  readonly resetSelectedCncTabAnchors: (layerColor: string) => void;
  readonly setSelectedCncTabAnchorDuringInteraction: (
    anchorIndex: number,
    layerColor: string,
    scenePoint: Vec2,
  ) => void;
};

export function cncTabActions(set: Setter): CncTabActions {
  return {
    seedSelectedCncTabAnchors: (layerColor, count) =>
      set((state) =>
        mutateSelectedTabs(state, (object) => seedObjectTabs(object, layerColor, count)),
      ),
    resetSelectedCncTabAnchors: (layerColor) =>
      set((state) => mutateSelectedTabs(state, (object) => resetObjectTabs(object, layerColor))),
    setSelectedCncTabAnchorDuringInteraction: (anchorIndex, layerColor, scenePoint) =>
      set((state) => moveTabAnchor(state, anchorIndex, layerColor, scenePoint)),
  };
}

function mutateSelectedTabs(
  state: CncTabState,
  mutate: (object: SceneObject) => SceneObject,
): Partial<CncTabState> {
  if (state.selectedObjectId === null || state.additionalSelectedIds.size > 0) return {};
  let changed = false;
  const objects = state.project.scene.objects.map((object) => {
    if (object.id !== state.selectedObjectId || object.locked === true) return object;
    const next = mutate(object);
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

function seedObjectTabs(object: SceneObject, layerColor: string, count: number): SceneObject {
  const cncTabAnchors = seedCncTabAnchors(object, layerColor, count);
  if (JSON.stringify(cncTabAnchors) === JSON.stringify(object.cncTabAnchors ?? [])) return object;
  return { ...object, cncTabAnchors };
}

function resetObjectTabs(object: SceneObject, layerColor: string): SceneObject {
  if (object.cncTabAnchors === undefined) return object;
  const remaining = object.cncTabAnchors.filter((anchor) => anchor.layerColor !== layerColor);
  if (remaining.length === object.cncTabAnchors.length) return object;
  if (remaining.length > 0) return { ...object, cncTabAnchors: remaining };
  const { cncTabAnchors: _removed, ...rest } = object;
  return rest;
}

function moveTabAnchor(
  state: CncTabState,
  anchorIndex: number,
  layerColor: string,
  scenePoint: Vec2,
): Partial<CncTabState> {
  if (state.selectedObjectId === null || !Number.isInteger(anchorIndex)) return {};
  if (!Number.isFinite(scenePoint.x) || !Number.isFinite(scenePoint.y)) return {};
  let changed = false;
  const objects = state.project.scene.objects.map((object) => {
    if (object.id !== state.selectedObjectId || object.locked === true) return object;
    const current = object.cncTabAnchors?.[anchorIndex];
    if (current === undefined || current.layerColor !== layerColor) return object;
    const projected = projectCncTabAnchor(object, layerColor, scenePoint);
    if (projected === null || JSON.stringify(projected) === JSON.stringify(current)) return object;
    const cncTabAnchors = [...(object.cncTabAnchors ?? [])];
    cncTabAnchors[anchorIndex] = projected;
    changed = true;
    return { ...object, cncTabAnchors };
  });
  return changed
    ? {
        project: { ...state.project, scene: { ...state.project.scene, objects } },
        dirty: true,
      }
    : {};
}
