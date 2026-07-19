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
import type { CncMachineStarterLiveCaps } from '../../core/cnc/machine-starters';
import type { DeviceProfile } from '../../core/devices';
import { deviceSupportsMachineKind } from '../../core/devices/device-profile';
import {
  jobPlacementAfterDeviceChange,
  jobPlacementAfterProfileSelection,
  type JobPlacementSettings,
} from '../job-placement';
import type { CncLibrary } from './cnc-library-persistence';
import { projectWithStockMaterial } from './cnc-project-material';
import { applyCncTextDefaultsForScene } from './cnc-text-defaults';
import { refreshAutomaticCncFeeds, seedCncModeSwitchLayers } from './cnc-auto-seeding';
import { pushUndo } from './scene-mutations';

type MachineState = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: boolean;
  readonly jobPlacement: JobPlacementSettings;
  readonly cachedCncMachine: CncMachineConfig | null;
  readonly cncLiveCaps: CncMachineStarterLiveCaps | null;
  // App-level custom bits (H.7) merge into every CNC session's tool list.
  readonly cncLibrary: CncLibrary;
};

type MachineSet = (fn: (state: MachineState) => Partial<MachineState>) => void;
type MachineGet = () => MachineState;

export type MachineKindSelectionResult =
  | { readonly kind: 'selected'; readonly machineKind: MachineKind }
  | { readonly kind: 'unchanged'; readonly machineKind: MachineKind }
  | { readonly kind: 'blocked-by-capability'; readonly requestedKind: MachineKind };

export type CncMachinePatch = {
  readonly toolId?: string;
  // Whole-list replacement (H.7 tool manager add/remove).
  readonly tools?: ReadonlyArray<CncTool>;
  readonly stock?: Partial<CncStock>;
  readonly params?: Partial<CncMachineParams>;
  // H.10: whole-block replacement; null clears tiling.
  readonly tiling?: CncTiling | null;
};

export type CncMachineSetupPatch = {
  readonly deviceProfile?: DeviceProfile;
  readonly devicePatch?: Partial<DeviceProfile>;
  readonly paramsPatch?: Partial<CncMachineParams>;
};

export type MachineActions = {
  readonly setMachineKind: (kind: MachineKind) => MachineKindSelectionResult;
  readonly updateCncMachine: (patch: CncMachinePatch) => void;
  // ADR-112: set (or clear, when null) the project stock material and auto-fill
  // every layer's feeds from it. One undoable step.
  readonly applyCncStockMaterial: (materialKey: string | null) => void;
  // Load a built-in CNC machine preset: seed the shared device bed and the CNC
  // spindle ceiling in one undoable step. CNC-only.
  readonly applyCncMachinePreset: (preset: CncMachinePreset) => void;
  readonly applyCncMachineSetup: (patch: CncMachineSetupPatch) => void;
};

// Library bits the session's tool list doesn't already carry are appended
// (id-keyed), so a saved custom bit is selectable in every CNC project.
export function cncMachineWithCustomTools(
  machine: CncMachineConfig,
  customTools: ReadonlyArray<CncTool>,
): CncMachineConfig {
  const missing = customTools.filter(
    (tool) => !machine.tools.some((existing) => existing.id === tool.id),
  );
  if (missing.length === 0) return machine;
  return { ...machine, tools: [...machine.tools, ...missing] };
}

export function machineActions(set: MachineSet, get: MachineGet): MachineActions {
  return {
    setMachineKind: (kind) => {
      const state = get();
      if (!deviceSupportsMachineKind(state.project.device, kind)) {
        return { kind: 'blocked-by-capability', requestedKind: kind };
      }
      if ((state.project.machine?.kind ?? 'laser') === kind) {
        return { kind: 'unchanged', machineKind: kind };
      }
      set((current) => machineKindStatePatch(current, kind));
      return { kind: 'selected', machineKind: kind };
    },
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
          project: {
            ...state.project,
            device: { ...state.project.device, cncSubProfile: { ...machine.params } },
            machine,
            scene: refreshAutomaticCncFeeds(state.project.scene, {
              device: { ...state.project.device, cncSubProfile: { ...machine.params } },
              machine,
              liveCaps: state.cncLiveCaps,
            }),
          },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    applyCncStockMaterial: (materialKey) =>
      set((state) => {
        const project = projectWithStockMaterial(state.project, materialKey, state.cncLiveCaps);
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
        // Bed lives on the shared device; the spindle ceiling on the CNC
        // params. Provenance-confirmed automatic settings follow that ceiling;
        // manual/legacy layer values remain explicit operator intent.
        return cncMachineSetupStatePatch(state, {
          devicePatch: {
            bedWidth: preset.bedWidthMm,
            bedHeight: preset.bedHeightMm,
          },
          paramsPatch: { spindleMaxRpm: preset.spindleMaxRpm },
        });
      }),
    applyCncMachineSetup: (patch) => set((state) => cncMachineSetupStatePatch(state, patch)),
  };
}

function machineKindStatePatch(state: MachineState, kind: MachineKind): Partial<MachineState> {
  const current = state.project.machine;
  const cachedBase = state.cachedCncMachine ?? DEFAULT_CNC_MACHINE_CONFIG;
  const cncBase =
    state.cachedCncMachine === null && state.project.device.cncSubProfile !== undefined
      ? { ...cachedBase, params: { ...state.project.device.cncSubProfile } }
      : cachedBase;
  const machine =
    kind === 'laser'
      ? LASER_MACHINE_CONFIG
      : cncMachineWithCustomTools(cncBase, state.cncLibrary.customTools);
  const device =
    current?.kind === 'cnc'
      ? { ...state.project.device, cncSubProfile: { ...current.params } }
      : state.project.device;
  const preparedScene =
    kind === 'cnc'
      ? applyCncTextDefaultsForScene(state.project.scene, machine)
      : state.project.scene;
  const scene =
    kind === 'cnc' && machine.kind === 'cnc'
      ? seedCncModeSwitchLayers(state.project.scene, preparedScene, {
          device,
          machine,
          liveCaps: state.cncLiveCaps,
        })
      : preparedScene;
  return {
    project: { ...state.project, device, machine, scene },
    cachedCncMachine: current?.kind === 'cnc' ? current : state.cachedCncMachine,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function cncMachineSetupStatePatch(
  state: MachineState,
  patch: CncMachineSetupPatch,
): Partial<MachineState> {
  const machine = state.project.machine;
  if (machine?.kind !== 'cnc') return {};
  const baseDevice = patch.deviceProfile ?? state.project.device;
  const device: DeviceProfile = { ...baseDevice, ...patch.devicePatch };
  const params = { ...machine.params, ...patch.paramsPatch };
  const deviceWithCnc: DeviceProfile = { ...device, cncSubProfile: { ...params } };
  const nextMachine: CncMachineConfig = { ...machine, params };
  const project: Project = {
    ...state.project,
    scene: refreshAutomaticCncFeeds(state.project.scene, {
      device: deviceWithCnc,
      machine: nextMachine,
      liveCaps: state.cncLiveCaps,
    }),
    device: deviceWithCnc,
    workspace: {
      ...state.project.workspace,
      width: deviceWithCnc.bedWidth,
      height: deviceWithCnc.bedHeight,
    },
    machine: nextMachine,
  };
  return {
    project,
    jobPlacement:
      patch.deviceProfile === undefined
        ? jobPlacementAfterDeviceChange(state.jobPlacement, state.project.device, deviceWithCnc)
        : jobPlacementAfterProfileSelection(
            state.jobPlacement,
            state.project.device,
            deviceWithCnc,
          ),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}
