// CNC library store slice (Phase H.7): custom bits, feeds/speeds presets,
// and named machine profiles. App-level state — the use-cnc-library-
// persistence hook restores it on boot and writes it back on change.
// Machine-touching actions (apply profile) go through the project with
// undo, exactly like updateCncMachine.

import type { CncLayerSettings, CncMachineConfig, CncTool } from '../../core/scene';
import {
  EMPTY_CNC_LIBRARY,
  feedPresetFromSettings,
  type CncFeedPreset,
  type CncLibrary,
  type CncMachineProfile,
} from './cnc-library-persistence';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

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
    addCustomCncTool: (tool) =>
      set((s) => {
        const withId: CncTool = { ...tool, id: crypto.randomUUID() };
        const library: CncLibrary = {
          ...s.cncLibrary,
          customTools: [...s.cncLibrary.customTools, withId],
        };
        // The new bit becomes selectable immediately in an open CNC project.
        const machine = s.project.machine;
        if (machine?.kind !== 'cnc') return { cncLibrary: library };
        return {
          cncLibrary: library,
          project: {
            ...s.project,
            machine: { ...machine, tools: [...machine.tools, withId] },
          },
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    deleteCustomCncTool: (toolId) =>
      set((s) => {
        const library: CncLibrary = {
          ...s.cncLibrary,
          customTools: s.cncLibrary.customTools.filter((tool) => tool.id !== toolId),
        };
        const machine = s.project.machine;
        if (machine?.kind !== 'cnc' || !machine.tools.some((tool) => tool.id === toolId)) {
          return { cncLibrary: library };
        }
        // Layers referencing the removed bit fall back to the machine bit
        // at compile time (layerCncTool); the active bit falls back via
        // activeCncTool. Undoable like any machine edit.
        return {
          cncLibrary: library,
          project: {
            ...s.project,
            machine: { ...machine, tools: machine.tools.filter((tool) => tool.id !== toolId) },
          },
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
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
        const machine: CncMachineConfig = profile.machine;
        return {
          project: { ...s.project, machine },
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
