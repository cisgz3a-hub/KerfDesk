// machine-actions — switch the project between laser and CNC machine kinds
// and edit the CNC machine setup (stock, active bit, safe Z, spindle).
//
// The CNC config is cached in (non-persisted) store state when the operator
// toggles back to laser, so flipping laser → cnc → laser → cnc round-trips
// stock/bit choices within a session. Per-layer CNC settings live on the
// Layer itself (layer.cnc) and are edited through the existing setLayerParam.

import {
  DEFAULT_CNC_MACHINE_CONFIG,
  LASER_MACHINE_CONFIG,
  type CncMachineConfig,
  type CncMachineParams,
  type CncStock,
  type CncTiling,
  type CncTool,
  type MachineKind,
  type Project,
} from '../../core/scene';
import type { CncMachinePreset } from '../../core/cnc';
import type { CncLibrary } from './cnc-library-persistence';
import { projectWithStockMaterial } from './cnc-project-material';
import { pushUndo } from './scene-mutations';

type MachineState = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: boolean;
  readonly cachedCncMachine: CncMachineConfig | null;
  // App-level custom bits (H.7) merge into every CNC session's tool list.
  readonly cncLibrary: CncLibrary;
};

type MachineSet = (fn: (state: MachineState) => Partial<MachineState>) => void;

export type CncMachinePatch = {
  readonly toolId?: string;
  // Whole-list replacement (H.7 tool manager add/remove).
  readonly tools?: ReadonlyArray<CncTool>;
  readonly stock?: Partial<CncStock>;
  readonly params?: Partial<CncMachineParams>;
  // H.10: whole-block replacement; null clears tiling.
  readonly tiling?: CncTiling | null;
};

export type MachineActions = {
  readonly setMachineKind: (kind: MachineKind) => void;
  readonly updateCncMachine: (patch: CncMachinePatch) => void;
  // ADR-112: set (or clear, when null) the project stock material and auto-fill
  // every layer's feeds from it. One undoable step.
  readonly applyCncStockMaterial: (materialKey: string | null) => void;
  // Load a built-in CNC machine preset: seed the shared device bed and the CNC
  // spindle ceiling in one undoable step. CNC-only.
  readonly applyCncMachinePreset: (preset: CncMachinePreset) => void;
};

// Library bits the session's tool list doesn't already carry are appended
// (id-keyed), so a saved custom bit is selectable in every CNC project.
function withCustomTools(
  machine: CncMachineConfig,
  customTools: ReadonlyArray<CncTool>,
): CncMachineConfig {
  const missing = customTools.filter(
    (tool) => !machine.tools.some((existing) => existing.id === tool.id),
  );
  if (missing.length === 0) return machine;
  return { ...machine, tools: [...machine.tools, ...missing] };
}

export function machineActions(set: MachineSet): MachineActions {
  return {
    setMachineKind: (kind) =>
      set((state) => {
        const current = state.project.machine;
        const currentKind = current?.kind ?? 'laser';
        if (currentKind === kind) return {};
        const machine =
          kind === 'laser'
            ? LASER_MACHINE_CONFIG
            : withCustomTools(
                state.cachedCncMachine ?? DEFAULT_CNC_MACHINE_CONFIG,
                state.cncLibrary.customTools,
              );
        return {
          project: { ...state.project, machine },
          cachedCncMachine: current?.kind === 'cnc' ? current : state.cachedCncMachine,
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    updateCncMachine: (patch) =>
      set((state) => {
        const current = state.project.machine;
        if (current?.kind !== 'cnc') return {};
        // Destructure tiling away so a null patch genuinely DELETES the key
        // (exact optional field — spreading undefined is not absence).
        const { tiling: currentTiling, ...base } = current;
        const nextTiling = patch.tiling === undefined ? (currentTiling ?? null) : patch.tiling;
        const machine: CncMachineConfig = {
          ...base,
          ...(patch.toolId !== undefined ? { toolId: patch.toolId } : {}),
          ...(patch.tools !== undefined ? { tools: patch.tools } : {}),
          stock: { ...current.stock, ...patch.stock },
          params: { ...current.params, ...patch.params },
          ...(nextTiling === null ? {} : { tiling: nextTiling }),
        };
        return {
          project: { ...state.project, machine },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    applyCncStockMaterial: (materialKey) =>
      set((state) => {
        const project = projectWithStockMaterial(state.project, materialKey);
        if (project === state.project) return {};
        return {
          project,
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    applyCncMachinePreset: (preset) =>
      set((state) => {
        const machine = state.project.machine;
        if (machine?.kind !== 'cnc') return {};
        // Bed lives on the shared device; the spindle ceiling on the CNC params.
        const project: Project = {
          ...state.project,
          device: {
            ...state.project.device,
            bedWidth: preset.bedWidthMm,
            bedHeight: preset.bedHeightMm,
          },
          machine: {
            ...machine,
            params: { ...machine.params, spindleMaxRpm: preset.spindleMaxRpm },
          },
        };
        return {
          project,
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}
