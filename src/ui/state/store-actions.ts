import type { DeviceProfile } from '../../core/devices';
import { deviceSupportsMachineKind } from '../../core/devices/device-profile';
import {
  moveLayer as moveSceneLayer,
  sceneObjectHasVisibleLayer,
  type CncMachineConfig,
  type CncTool,
  type MachineConfig,
  type Project,
  type Transform,
  updateLayer,
} from '../../core/scene';
import {
  jobPlacementAfterDeviceChange,
  jobPlacementAfterProfileSelection,
  type JobPlacementSettings,
} from '../job-placement';
import { fitToSelection } from './viewport-actions';
import { applyDuplicate, HISTORY_DEPTH, pushUndo } from './scene-mutations';
import { selectionFromIds, toggleSelectionFromId } from './scene-group-actions';
import type { AppState, OutputScopeSettings } from './store';
import { cncMachineWithCustomTools } from './machine-actions';
import { projectAfterDeviceProfileChange, sceneAfterMachineSetup } from './cnc-machine-setup-scene';

type Setter = (
  fn: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
) => void;

export type MachineSetupReplacementResult =
  | { readonly kind: 'applied' }
  | { readonly kind: 'blocked-by-capability'; readonly requestedKind: MachineConfig['kind'] };

export function sceneActions(
  set: Setter,
): Pick<
  AppState,
  | 'setLayerParam'
  | 'moveLayer'
  | 'updateDeviceProfile'
  | 'replaceDeviceProfile'
  | 'replaceMachineSetup'
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
        const nextDevice: DeviceProfile = { ...s.project.device, ...patch };
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
        return {
          project: projectAfterDeviceProfileChange(s.project, profile, s.cncLiveCaps),
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
    ...replaceMachineSetupAction(set),
  };
}

function replaceMachineSetupAction(set: Setter): Pick<AppState, 'replaceMachineSetup'> {
  return {
    replaceMachineSetup: (
      profile: DeviceProfile,
      machine: MachineConfig,
      retainedMachine?: MachineConfig,
    ) => {
      if (!deviceSupportsMachineKind(profile, machine.kind)) {
        return { kind: 'blocked-by-capability', requestedKind: machine.kind };
      }
      set((s) => replacementMachineSetupState(s, profile, machine, retainedMachine));
      return { kind: 'applied' };
    },
  };
}

function replacementMachineSetupState(
  state: AppState,
  profile: DeviceProfile,
  machine: MachineConfig,
  retainedMachine?: MachineConfig,
): Partial<AppState> {
  const nextMachine = machineWithCustomTools(machine, state.cncLibrary.customTools);
  const retainedCnc = retainedCncForSetup(state, nextMachine, retainedMachine);
  const nextCachedCnc = cachedCncWithCustomTools(retainedCnc, state.cncLibrary.customTools);
  const nextProfile = profileWithCncSettings(profile, nextCachedCnc);
  const scene = sceneAfterMachineSetup(
    state.project.scene,
    state.project.machine,
    nextProfile,
    nextMachine,
    state.cncLiveCaps,
  );
  return {
    project: {
      ...state.project,
      scene,
      device: nextProfile,
      machine: nextMachine,
      workspace: {
        ...state.project.workspace,
        width: nextProfile.bedWidth,
        height: nextProfile.bedHeight,
      },
    },
    jobPlacement: jobPlacementAfterProfileSelection(
      state.jobPlacement,
      state.project.device,
      nextProfile,
    ),
    cachedCncMachine: nextCachedCnc,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function machineWithCustomTools(
  machine: MachineConfig,
  customTools: ReadonlyArray<CncTool>,
): MachineConfig {
  return machine.kind === 'cnc' ? cncMachineWithCustomTools(machine, customTools) : machine;
}

function retainedCncForSetup(
  state: AppState,
  nextMachine: MachineConfig,
  retainedMachine?: MachineConfig,
): CncMachineConfig | null {
  if (nextMachine.kind === 'cnc') return nextMachine;
  if (retainedMachine?.kind === 'cnc') return retainedMachine;
  if (state.project.machine?.kind === 'cnc') return state.project.machine;
  return state.cachedCncMachine;
}

function cachedCncWithCustomTools(
  machine: CncMachineConfig | null,
  customTools: ReadonlyArray<CncTool>,
): CncMachineConfig | null {
  return machine === null ? null : cncMachineWithCustomTools(machine, customTools);
}

function profileWithCncSettings(
  profile: DeviceProfile,
  cachedCnc: CncMachineConfig | null,
): DeviceProfile {
  if (profile.capabilities?.includes('cnc-output') !== true || cachedCnc === null) return profile;
  return { ...profile, cncSubProfile: { ...cachedCnc.params } };
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
          // Keep the selection whose ids still resolve to a live object in the
          // restored scene (CNV-13); node selection is cleared because its
          // indices reference the pre-restore geometry.
          ...visibleSelectionState(s, prev),
          selectedPathNode: null,
          selectedPathNodes: [],
          registrationArtworkOutputSnapshot: null,
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
          // Symmetric with undo: keep the selection that still resolves in the
          // restored scene (CNV-13); node selection is cleared (stale indices).
          ...visibleSelectionState(s, next),
          selectedPathNode: null,
          selectedPathNodes: [],
          registrationArtworkOutputSnapshot: null,
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
        // Exiting Preview drops any external .nc program (F-CNC10): the
        // next Preview shows the project's own compiled toolpath again.
        ...(s.previewMode ? { externalGcodePreview: null } : {}),
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
  | 'beginInteraction'
  | 'setObjectTransform'
  | 'endInteraction'
  | 'cancelInteraction'
  | 'applyObjectTransform'
> {
  return {
    beginInteraction: () => set((s) => ({ pendingUndo: s.project })),
    setObjectTransform: (id, transform) =>
      set((s) => ({ project: applyTransformToScene(s.project, id, transform), dirty: true })),
    // Esc mid-drag: restore the pre-interaction project snapshot and drop it,
    // pushing no undo entry (the drag never happened). No-op if nothing was
    // snapshotted (audit C4).
    cancelInteraction: () =>
      set((s) => (s.pendingUndo === null ? {} : { project: s.pendingUndo, pendingUndo: null })),
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
    markLoaded: (filename, options) =>
      set({ dirty: options?.dirty ?? false, savedName: filename, lastSaveTarget: null }),
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
