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
import {
  refreshAutomaticCncFeeds,
  refreshAutomaticCncFeedsAfterToolRemoval,
} from './cnc-auto-seeding';
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
        const tools = machine.tools.filter((tool) => tool.id !== toolId);
        const nextMachine: CncMachineConfig = {
          ...machine,
          tools,
          toolId:
            machine.toolId === toolId && tools[0] !== undefined ? tools[0].id : machine.toolId,
        };
        const scene = refreshAutomaticCncFeedsAfterToolRemoval(
          s.project.scene,
          {
            device: s.project.device,
            machine: nextMachine,
            liveCaps: s.cncLiveCaps,
          },
          toolId,
        );
        // Manual/legacy layer settings remain exact. Only material recipes
        // carrying automatic provenance drop a deleted override and recalculate
        // against the surviving active bit.
        return {
          cncLibrary: library,
          project: {
            ...s.project,
            scene,
            machine: nextMachine,
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
        // Bits added after the profile was saved survive the apply — a
        // wholesale replace silently deleted them and layers referencing
        // them fell back to the machine bit.
        const currentTools = s.project.machine.tools;
        const machine: CncMachineConfig = {
          ...profile.machine,
          tools: [
            ...profile.machine.tools,
            ...currentTools.filter(
              (tool) => !profile.machine.tools.some((kept) => kept.id === tool.id),
            ),
          ],
        };
        const device = { ...s.project.device, cncSubProfile: { ...machine.params } };
        const scene = refreshAutomaticCncFeeds(s.project.scene, {
          device,
          machine,
          liveCaps: s.cncLiveCaps,
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
