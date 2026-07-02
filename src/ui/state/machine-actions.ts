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
  type MachineKind,
  type Project,
} from '../../core/scene';
import { pushUndo } from './scene-mutations';

type MachineState = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: boolean;
  readonly cachedCncMachine: CncMachineConfig | null;
};

type MachineSet = (fn: (state: MachineState) => Partial<MachineState>) => void;

export type CncMachinePatch = {
  readonly toolId?: string;
  readonly stock?: Partial<CncStock>;
  readonly params?: Partial<CncMachineParams>;
};

export type MachineActions = {
  readonly setMachineKind: (kind: MachineKind) => void;
  readonly updateCncMachine: (patch: CncMachinePatch) => void;
};

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
            : (state.cachedCncMachine ?? DEFAULT_CNC_MACHINE_CONFIG);
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
