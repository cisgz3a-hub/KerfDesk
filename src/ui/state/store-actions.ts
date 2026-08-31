import { deviceProfileWithInteractivePatch } from '../../core/devices/device-profile-patch';
import {
  moveLayer as moveSceneLayer,
  sceneObjectHasVisibleLayer,
  type Project,
  type Transform,
  updateLayer,
} from '../../core/scene';
import { jobPlacementAfterDeviceChange, jobPlacementAfterProfileSelection } from '../job-placement';
import { fitToSelection } from './viewport-actions';
import { applyDuplicate, HISTORY_DEPTH, pushUndo } from './scene-mutations';
import { selectionFromIds, toggleSelectionFromId } from './scene-group-actions';
import type { AppState } from './store';
import { projectAfterDeviceProfileChange } from './cnc-machine-setup-scene';
import { captureSetupHistoryContext, setupHistoryContextFor } from './setup-history-context';
import { machineSetupActions } from './machine-setup-actions';
import {
  nextProbeSetupState,
  projectsShareProbeSetupIdentity,
} from './probe-setup-history-identity';
import {
  jobPlacementProjectPatch,
  outputScopeProjectPatch,
  scopedSelectionProjectPatch,
} from './project-job-setup';

type Setter = (
  fn: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
) => void;

export function sceneActions(
  set: Setter,
): Pick<
  AppState,
  | 'setLayerParam'
  | 'moveLayer'
  | 'updateDeviceProfile'
  | 'replaceDeviceProfile'
  | 'replaceMachineSetup'
  | 'replaceCncStartupSetup'
> {
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
        captureSetupHistoryContext(s.project, s);
        const nextDevice = deviceProfileWithInteractivePatch(s.project.device, patch);
        return {
          project: projectAfterDeviceProfileChange(s.project, nextDevice, s.cncLiveCaps),
          jobPlacement: jobPlacementAfterDeviceChange(s.jobPlacement, s.project.device, nextDevice),
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    replaceDeviceProfile: (profile) =>
      set((s) => {
        captureSetupHistoryContext(s.project, s);
        return {
          ...nextProbeSetupState(
            projectAfterDeviceProfileChange(s.project, profile, s.cncLiveCaps),
            s.probeSetupEpoch,
          ),
          jobPlacement: jobPlacementAfterProfileSelection(
            s.jobPlacement,
            s.project.device,
            profile,
          ),
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    ...machineSetupActions(set),
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
        if (s.pendingUndo !== null) {
          // Ctrl/Cmd+Z during a live drag cancels that uncommitted gesture.
          // The interaction snapshot is newer than the top of undoStack; if
          // we skipped it, Undo popped an unrelated older edit and left the
          // drag mutation in the project.
          return {
            ...s.pendingUndo,
            additionalSelectedIds: new Set(s.pendingUndo.additionalSelectedIds),
            pendingUndo: null,
          };
        }
        const prev = s.undoStack[s.undoStack.length - 1];
        if (prev === undefined) return s;
        const context = setupHistoryContextFor(prev);
        if (context !== null) captureSetupHistoryContext(s.project, s);
        return {
          project: prev,
          probeSetupEpoch: probeSetupEpochAfterHistoryRestore(s, prev),
          undoStack: s.undoStack.slice(0, -1),
          redoStack: [...s.redoStack, s.project].slice(-HISTORY_DEPTH),
          // Keep the selection whose ids still resolve to a live object in the
          // restored scene (CNV-13); node selection is cleared because its
          // indices reference the pre-restore geometry.
          ...visibleSelectionState(s, prev),
          selectedPathNode: null,
          selectedPathNodes: [],
          registrationArtworkOutputSnapshot: null,
          dirty: true,
          ...(context ?? {}),
        };
      }),
    redo: () =>
      set((s) => {
        const next = s.redoStack[s.redoStack.length - 1];
        if (next === undefined) return s;
        const context = setupHistoryContextFor(next);
        if (context !== null) captureSetupHistoryContext(s.project, s);
        return {
          project: next,
          probeSetupEpoch: probeSetupEpochAfterHistoryRestore(s, next),
          redoStack: s.redoStack.slice(0, -1),
          undoStack: [...s.undoStack, s.project].slice(-HISTORY_DEPTH),
          // Symmetric with undo: keep the selection that still resolves in the
          // restored scene (CNV-13); node selection is cleared (stale indices).
          ...visibleSelectionState(s, next),
          selectedPathNode: null,
          selectedPathNodes: [],
          registrationArtworkOutputSnapshot: null,
          dirty: true,
          ...(context ?? {}),
        };
      }),
  };
}

function probeSetupEpochAfterHistoryRestore(state: AppState, restored: Project): number {
  return projectsShareProbeSetupIdentity(state.project, restored)
    ? state.probeSetupEpoch
    : state.probeSetupEpoch + 1;
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
      set((s) => ({
        ...scopedSelectionProjectPatch(
          s,
          id === null
            ? { selectedObjectId: null, additionalSelectedIds: new Set() }
            : selectionFromIds(s, [id], false),
        ),
        selectedPathNode: null,
        selectedPathNodes: [],
      })),
    toggleSelectObject: (id) =>
      set((s) => ({
        ...scopedSelectionProjectPatch(s, toggleSelectionFromId(s, id)),
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
          ...scopedSelectionProjectPatch(s, {
            selectedObjectId: primary ?? null,
            additionalSelectedIds: new Set(rest),
          }),
          selectedPathNode: null,
          selectedPathNodes: [],
        };
      }),
    selectObjects: (ids, options = {}) =>
      set((s) => ({
        ...scopedSelectionProjectPatch(s, selectionFromIds(s, ids, options.additive === true)),
        selectedPathNode: null,
        selectedPathNodes: [],
      })),
    togglePreview: () =>
      set((s) => ({
        previewMode: !s.previewMode,
        // Exiting Preview drops any external .nc program (F-CNC10): the
        // next Preview shows the project's own compiled toolpath again.
        ...(s.previewMode ? { externalGcodePreview: null } : {}),
        selectedPathNode: null,
        selectedPathNodes: [],
      })),
    setJobPlacement: (patch) => set((s) => jobPlacementProjectPatch(s, patch)),
    setOutputScopeSettings: (patch) => set((s) => outputScopeProjectPatch(s, patch)),
    setCursorMm: (cursor) => set({ cursorMm: cursor }),
  };
}

export function interactionActions(
  set: Setter,
): Pick<
  AppState,
  | 'beginInteraction'
  | 'setObjectTransform'
  | 'endInteraction'
  | 'cancelInteraction'
  | 'applyObjectTransform'
> {
  return {
    beginInteraction: () =>
      set((s) => ({
        pendingUndo: {
          project: s.project,
          undoStack: s.undoStack,
          redoStack: s.redoStack,
          dirty: s.dirty,
          selectedObjectId: s.selectedObjectId,
          additionalSelectedIds: new Set(s.additionalSelectedIds),
          selectedPathNode: s.selectedPathNode,
          selectedPathNodes: s.selectedPathNodes,
        },
      })),
    setObjectTransform: (id, transform) =>
      set((s) => ({ project: applyTransformToScene(s.project, id, transform), dirty: true })),
    // Esc mid-drag: restore the pre-interaction project snapshot and drop it,
    // pushing no undo entry (the drag never happened). No-op if nothing was
    // snapshotted (audit C4).
    cancelInteraction: () =>
      set((s) =>
        s.pendingUndo === null
          ? {}
          : {
              ...s.pendingUndo,
              additionalSelectedIds: new Set(s.pendingUndo.additionalSelectedIds),
              pendingUndo: null,
            },
      ),
    endInteraction: () =>
      set((s) => {
        if (s.pendingUndo === null) return s;
        if (s.pendingUndo.project === s.project) return { pendingUndo: null };
        return {
          pendingUndo: null,
          undoStack: pushUndo(s.pendingUndo.project, s.pendingUndo.undoStack),
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
