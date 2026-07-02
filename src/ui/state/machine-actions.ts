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
  type CncTool,
  type MachineKind,
  type Project,
} from '../../core/scene';
import type { CncLibrary } from './cnc-library-persistence';
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
};

export type MachineActions = {
  readonly setMachineKind: (kind: MachineKind) => void;
  readonly updateCncMachine: (patch: CncMachinePatch) => void;
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
        const machine: CncMachineConfig = {
          ...current,
          ...(patch.toolId !== undefined ? { toolId: patch.toolId } : {}),
          ...(patch.tools !== undefined ? { tools: patch.tools } : {}),
          stock: { ...current.stock, ...patch.stock },
          params: { ...current.params, ...patch.params },
        };
        return {
          project: { ...state.project, machine },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}
