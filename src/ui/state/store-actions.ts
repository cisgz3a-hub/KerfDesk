import type { DeviceProfile } from '../../core/devices';
import {
  moveLayer as moveSceneLayer,
  sceneObjectHasVisibleLayer,
  type Project,
  type Transform,
  updateLayer,
} from '../../core/scene';
import type { JobPlacementSettings } from '../job-placement';
import { fitToSelection } from './viewport-actions';
import { applyDuplicate, pushUndo } from './scene-mutations';
import { selectionFromIds, toggleSelectionFromId } from './scene-group-actions';
import type { AppState, OutputScopeSettings } from './store';

const HISTORY_DEPTH = 50;

type Setter = (
  fn: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
) => void;

export function sceneActions(
  set: Setter,
): Pick<AppState, 'setLayerParam' | 'moveLayer' | 'updateDeviceProfile' | 'replaceDeviceProfile'> {
  return {
    setLayerParam: (layerId, patch) =>
      set((s) => {
        const project = {
          ...s.project,
          scene: updateLayer(s.project.scene, layerId, patch),
        };
        return {
          project,
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
          ...(patch.visible === false ? visibleSelectionState(s, project) : {}),
        };
      }),
    moveLayer: (layerId, direction) =>
      set((s) => {
        const scene = moveSceneLayer(s.project.scene, layerId, direction);
        if (scene === s.project.scene) return s;
        return {
          project: { ...s.project, scene },
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    updateDeviceProfile: (patch) =>
      set((s) => {
        const nextDevice: DeviceProfile = { ...s.project.device, ...patch };
        const nextWorkspace =
          patch.bedWidth !== undefined || patch.bedHeight !== undefined
            ? {
                ...s.project.workspace,
                width: nextDevice.bedWidth,
                height: nextDevice.bedHeight,
              }
            : s.project.workspace;
        return {
          project: { ...s.project, device: nextDevice, workspace: nextWorkspace },
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    replaceDeviceProfile: (profile) =>
      set((s) => ({
        project: {
          ...s.project,
          device: profile,
          workspace: {
            ...s.project.workspace,
            width: profile.bedWidth,
            height: profile.bedHeight,
          },
        },
        undoStack: pushUndo(s.project, s.undoStack),
        redoStack: [],
        dirty: true,
      })),
  };
}

export function duplicateAction(set: Setter): Pick<AppState, 'duplicateSelection'> {
  return {
    duplicateSelection: () =>
      set((s) => {
        const result = applyDuplicate(s, () => crypto.randomUUID());
        return result ?? s;
      }),
  };
}

export function fitToSelectionAction(get: () => AppState): Pick<AppState, 'fitToSelection'> {
  return {
    fitToSelection: () => fitToSelection(get),
  };
}

export function historyActions(set: Setter): Pick<AppState, 'undo' | 'redo'> {
  return {
    undo: () =>
      set((s) => {
        const prev = s.undoStack[s.undoStack.length - 1];
        if (prev === undefined) return s;
        return {
          project: prev,
          undoStack: s.undoStack.slice(0, -1),
          redoStack: [...s.redoStack, s.project].slice(-HISTORY_DEPTH),
          selectedObjectId: null,
          additionalSelectedIds: new Set(),
          selectedPathNode: null,
          selectedPathNodes: [],
          dirty: true,
        };
      }),
    redo: () =>
      set((s) => {
        const next = s.redoStack[s.redoStack.length - 1];
        if (next === undefined) return s;
        return {
          project: next,
          redoStack: s.redoStack.slice(0, -1),
          undoStack: [...s.undoStack, s.project].slice(-HISTORY_DEPTH),
          selectedObjectId: null,
          additionalSelectedIds: new Set(),
          selectedPathNode: null,
          selectedPathNodes: [],
          dirty: true,
        };
      }),
  };
}

export function viewActions(
  set: Setter,
): Pick<
  AppState,
  | 'selectObject'
  | 'toggleSelectObject'
  | 'selectAllObjects'
  | 'selectObjects'
  | 'togglePreview'
  | 'setJobPlacement'
  | 'setOutputScopeSettings'
  | 'setCursorMm'
> {
  return {
    selectObject: (id) =>
      set((s) =>
        id === null
          ? {
              selectedObjectId: null,
              selectedPathNode: null,
              selectedPathNodes: [],
              additionalSelectedIds: new Set(),
            }
          : { ...selectionFromIds(s, [id], false), selectedPathNode: null, selectedPathNodes: [] },
      ),
    toggleSelectObject: (id) =>
      set((s) => ({
        ...toggleSelectionFromId(s, id),
        selectedPathNode: null,
        selectedPathNodes: [],
      })),
    selectAllObjects: () =>
      set((s) => {
        const ids = s.project.scene.objects
          .filter((object) => object.locked !== true)
          .filter((object) => sceneObjectHasVisibleLayer(s.project.scene, object))
          .map((o) => o.id);
        const [primary, ...rest] = ids;
        return {
          selectedObjectId: primary ?? null,
          selectedPathNode: null,
          selectedPathNodes: [],
          additionalSelectedIds: new Set(rest),
        };
      }),
    selectObjects: (ids, options = {}) =>
      set((s) => ({
        ...selectionFromIds(s, ids, options.additive === true),
        selectedPathNode: null,
        selectedPathNodes: [],
      })),
    togglePreview: () =>
      set((s) => ({
        previewMode: !s.previewMode,
        selectedPathNode: null,
        selectedPathNodes: [],
      })),
    setJobPlacement: (patch) =>
      set((s) => ({ jobPlacement: mergeJobPlacement(s.jobPlacement, patch) })),
    setOutputScopeSettings: (patch) =>
      set((s) => ({ outputScopeSettings: mergeOutputScope(s.outputScopeSettings, patch) })),
    setCursorMm: (cursor) => set({ cursorMm: cursor }),
  };
}

export function interactionActions(
  set: Setter,
): Pick<
  AppState,
  'beginInteraction' | 'setObjectTransform' | 'endInteraction' | 'applyObjectTransform'
> {
  return {
    beginInteraction: () => set((s) => ({ pendingUndo: s.project })),
    setObjectTransform: (id, transform) =>
      set((s) => ({ project: applyTransformToScene(s.project, id, transform), dirty: true })),
    endInteraction: () =>
      set((s) => {
        if (s.pendingUndo === null) return s;
        if (s.pendingUndo === s.project) return { pendingUndo: null };
        return {
          pendingUndo: null,
          undoStack: pushUndo(s.pendingUndo, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    applyObjectTransform: (id, transform) =>
      set((s) => ({
        project: applyTransformToScene(s.project, id, transform),
        undoStack: pushUndo(s.project, s.undoStack),
        redoStack: [],
        dirty: true,
      })),
  };
}

export function saveTrackingActions(set: Setter): Pick<AppState, 'markSaved' | 'markLoaded'> {
  return {
    markSaved: (target) =>
      set({ dirty: false, savedName: target.displayName, lastSaveTarget: target }),
    markLoaded: (filename) => set({ dirty: false, savedName: filename, lastSaveTarget: null }),
  };
}

function mergeJobPlacement(
  jobPlacement: JobPlacementSettings,
  patch: Partial<JobPlacementSettings>,
): JobPlacementSettings {
  return { ...jobPlacement, ...patch };
}

function mergeOutputScope(
  outputScopeSettings: OutputScopeSettings,
  patch: Partial<OutputScopeSettings>,
): OutputScopeSettings {
  const next = { ...outputScopeSettings, ...patch };
  return {
    ...next,
    useSelectionOrigin: next.cutSelectedGraphics ? next.useSelectionOrigin : false,
  };
}

function visibleSelectionState(
  state: AppState,
  project: Project,
): Pick<AppState, 'selectedObjectId' | 'additionalSelectedIds'> {
  const selectedIds = [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ].filter((id) => {
    const object = project.scene.objects.find((candidate) => candidate.id === id);
    return (
      object !== undefined &&
      object.locked !== true &&
      sceneObjectHasVisibleLayer(project.scene, object)
    );
  });
  const [primary, ...rest] = selectedIds;
  return {
    selectedObjectId: primary ?? null,
    additionalSelectedIds: new Set(rest),
  };
}

function applyTransformToScene(project: Project, id: string, transform: Transform): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((o) =>
        o.id === id && o.locked !== true ? { ...o, transform } : o,
      ),
    },
  };
}
