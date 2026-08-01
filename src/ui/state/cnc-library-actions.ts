// CNC library store slice (Phase H.7): custom bits, feeds/speeds presets,
// and named machine profiles. App-level state — the use-cnc-library-
// persistence hook restores it on boot and writes it back on change.
// Machine-touching actions (apply profile) go through the project with
// undo, exactly like updateCncMachine.

import {
  activeCncTool,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_TOOLS,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Scene,
} from '../../core/scene';
import {
  EMPTY_CNC_LIBRARY,
  feedPresetFromSettings,
  type CncFeedPreset,
  type CncLibrary,
  type CncMachineProfile,
} from './cnc-library-persistence';
import {
  refreshAutomaticCncFeeds,
  refreshAutomaticCncFeedsAfterToolRemoval,
} from './cnc-auto-seeding';
import {
  activeCncToolFeedIdentityChanged,
  mergeCncMachineProfileForCurrentProject,
} from './cnc-machine-profile-merge';
import {
  blockingCncSecondaryToolReferences,
  sceneWithoutDormantCncSecondaryToolReferences,
} from './cnc-tool-references';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;
type StatePatch = AppState | Partial<AppState>;

export type CncLibraryActions = {
  readonly setCncLibrary: (library: CncLibrary) => void;
  readonly addCustomCncTool: (tool: Omit<CncTool, 'id'>) => void;
  readonly deleteCustomCncTool: (toolId: string) => void;
  readonly saveCncFeedPreset: (name: string, settings: CncLayerSettings) => void;
  readonly deleteCncFeedPreset: (presetId: string) => void;
  readonly saveCncMachineProfile: (name: string) => void;
  readonly applyCncMachineProfile: (profileId: string) => void;
  readonly deleteCncMachineProfile: (profileId: string) => void;
};

export const CNC_LIBRARY_STATE_DEFAULTS: { cncLibrary: CncLibrary } = {
  cncLibrary: EMPTY_CNC_LIBRARY,
};

export function cncLibraryActions(set: Setter): CncLibraryActions {
  return {
    setCncLibrary: (library) => set(() => ({ cncLibrary: library })),
    ...customToolActions(set),
    ...feedPresetActions(set),
    ...machineProfileActions(set),
  };
}

function customToolActions(
  set: Setter,
): Pick<CncLibraryActions, 'addCustomCncTool' | 'deleteCustomCncTool'> {
  return {
    addCustomCncTool: (tool) => set((state) => addCustomToolPatch(state, tool)),
    deleteCustomCncTool: (toolId) => set((state) => stateAfterCustomToolDeletion(state, toolId)),
  };
}

function addCustomToolPatch(state: AppState, tool: Omit<CncTool, 'id'>): StatePatch {
  if (catalogToolAlreadySaved(state, tool.catalogId)) return state;
  const machine = state.project.machine;
  const matchingMachineTool =
    machine?.kind === 'cnc' && tool.catalogId !== undefined
      ? matchingMachineCatalogTool(machine, tool.catalogId)
      : undefined;
  const withId: CncTool = { ...tool, id: matchingMachineTool?.id ?? crypto.randomUUID() };
  const library: CncLibrary = {
    ...state.cncLibrary,
    customTools: [...state.cncLibrary.customTools, withId],
  };
  if (machine?.kind !== 'cnc') return { cncLibrary: library };
  const tools =
    matchingMachineTool === undefined
      ? [...machine.tools, withId]
      : machine.tools.map((candidate) =>
          candidate.id === matchingMachineTool.id ? withId : candidate,
        );
  const nextMachine: CncMachineConfig = { ...machine, tools };
  const scene =
    matchingMachineTool === undefined
      ? state.project.scene
      : refreshAutomaticCncFeeds(state.project.scene, {
          device: state.project.device,
          machine: nextMachine,
          liveCaps: state.cncLiveCaps,
          activeToolChanged: activeCncToolFeedIdentityChanged(machine, nextMachine),
        });
  return {
    cncLibrary: library,
    project: { ...state.project, scene, machine: nextMachine },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function matchingMachineCatalogTool(
  machine: CncMachineConfig,
  catalogId: string,
): CncTool | undefined {
  const activeTool = activeCncTool(machine);
  return activeTool.catalogId === catalogId
    ? activeTool
    : machine.tools.find((candidate) => candidate.catalogId === catalogId);
}

function catalogToolAlreadySaved(state: AppState, catalogId: string | undefined): boolean {
  return (
    catalogId !== undefined &&
    (DEFAULT_CNC_TOOLS.some((candidate) => candidate.catalogId === catalogId) ||
      state.cncLibrary.customTools.some((candidate) => candidate.catalogId === catalogId))
  );
}

function stateAfterCustomToolDeletion(state: AppState, toolId: string): StatePatch {
  // Active clearing/finishing/roughing stages have no safe implicit fallback.
  // Keep this refusal below the UI so command callers cannot bypass it.
  if (blockingCncSecondaryToolReferences(state.project.scene, toolId).length > 0) return state;
  const preparedScene = sceneWithoutDormantCncSecondaryToolReferences(state.project.scene, toolId);
  const library: CncLibrary = {
    ...state.cncLibrary,
    customTools: state.cncLibrary.customTools.filter((tool) => tool.id !== toolId),
  };
  const machine = state.project.machine;
  if (machine?.kind !== 'cnc' || !machine.tools.some((tool) => tool.id === toolId)) {
    return libraryDeletionWithoutMachineUpdate(state, library, preparedScene);
  }
  const remainingTools = machine.tools.filter((tool) => tool.id !== toolId);
  const tools = remainingTools.length === 0 ? DEFAULT_CNC_MACHINE_CONFIG.tools : remainingTools;
  const machineWithSurvivingTools: CncMachineConfig = { ...machine, tools };
  const nextMachine: CncMachineConfig = {
    ...machineWithSurvivingTools,
    toolId: activeCncTool(machineWithSurvivingTools).id,
  };
  const scene = refreshAutomaticCncFeedsAfterToolRemoval(
    preparedScene,
    {
      device: state.project.device,
      machine: nextMachine,
      liveCaps: state.cncLiveCaps,
      activeToolChanged: activeCncToolFeedIdentityChanged(machine, nextMachine),
    },
    toolId,
  );
  // Manual/legacy primary settings remain exact. Material recipes carrying
  // automatic provenance recalculate against the surviving Active bit.
  return {
    cncLibrary: library,
    project: { ...state.project, scene, machine: nextMachine },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function libraryDeletionWithoutMachineUpdate(
  state: AppState,
  library: CncLibrary,
  scene: Scene,
): Partial<AppState> {
  if (scene === state.project.scene) return { cncLibrary: library };
  return {
    cncLibrary: library,
    project: { ...state.project, scene },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function feedPresetActions(
  set: Setter,
): Pick<CncLibraryActions, 'saveCncFeedPreset' | 'deleteCncFeedPreset'> {
  return {
    saveCncFeedPreset: (name, settings) =>
      set((s) => ({
        cncLibrary: {
          ...s.cncLibrary,
          feedPresets: [
            ...s.cncLibrary.feedPresets,
            feedPresetFromSettings(crypto.randomUUID(), name, settings),
          ],
        },
      })),
    deleteCncFeedPreset: (presetId) =>
      set((s) => ({
        cncLibrary: {
          ...s.cncLibrary,
          feedPresets: s.cncLibrary.feedPresets.filter((preset) => preset.id !== presetId),
        },
      })),
  };
}

function machineProfileActions(
  set: Setter,
): Pick<
  CncLibraryActions,
  'saveCncMachineProfile' | 'applyCncMachineProfile' | 'deleteCncMachineProfile'
> {
  return {
    saveCncMachineProfile: (name) =>
      set((s) => {
        const machine = s.project.machine;
        if (machine?.kind !== 'cnc') return s;
        const profile: CncMachineProfile = { id: crypto.randomUUID(), name, machine };
        return {
          cncLibrary: {
            ...s.cncLibrary,
            machineProfiles: [...s.cncLibrary.machineProfiles, profile],
          },
        };
      }),
    applyCncMachineProfile: (profileId) =>
      set((s) => {
        if (s.project.machine?.kind !== 'cnc') return s;
        const profile = s.cncLibrary.machineProfiles.find((p) => p.id === profileId);
        if (profile === undefined) return s;
        // Bits added after the profile was saved survive the apply. Catalog
        // identity also preserves the project's copy (and therefore layer
        // references) when a profile carries the same physical bit under a
        // different generated id.
        const previousMachine = s.project.machine;
        const machine = mergeCncMachineProfileForCurrentProject(profile.machine, previousMachine);
        const device = { ...s.project.device, cncSubProfile: { ...machine.params } };
        const scene = refreshAutomaticCncFeeds(s.project.scene, {
          device,
          machine,
          liveCaps: s.cncLiveCaps,
          activeToolChanged: activeCncToolFeedIdentityChanged(previousMachine, machine),
        });
        return {
          project: { ...s.project, scene, device, machine },
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    deleteCncMachineProfile: (profileId) =>
      set((s) => ({
        cncLibrary: {
          ...s.cncLibrary,
          machineProfiles: s.cncLibrary.machineProfiles.filter((p) => p.id !== profileId),
        },
      })),
  };
}

// Feed presets apply as a plain layer patch (the caller routes it through
// setLayerParam so undo/dirty ride the existing path).
export function feedPresetPatch(preset: CncFeedPreset): Partial<CncLayerSettings> {
  return {
    feedMmPerMin: preset.feedMmPerMin,
    plungeMmPerMin: preset.plungeMmPerMin,
    spindleRpm: preset.spindleRpm,
    depthPerPassMm: preset.depthPerPassMm,
    stepoverPercent: preset.stepoverPercent,
  };
}
