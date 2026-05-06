import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { type GcodeStartMode } from '../../core/output/GcodeOrigin';

export type SavedOrigin = { x: number; y: number };

export interface MachineStartState {
  profileRevision: number;
  startMode: GcodeStartMode;
  savedOrigin: SavedOrigin | null;
}

export interface MachineStartActions {
  bumpProfileRevision: () => void;
  setStartMode: (mode: GcodeStartMode) => void;
  setSavedOrigin: (origin: SavedOrigin | null) => void;
  clearSavedOrigin: () => void;
  resetCurrentModeAfterDisconnect: () => void;
  resetMachineStart: () => void;
}

export type MachineStartStore = MachineStartState & MachineStartActions;

export const machineStartInitialState: MachineStartState = {
  profileRevision: 0,
  startMode: 'absolute',
  savedOrigin: null,
};

export interface CreateMachineStartStoreOptions {
  readonly initialStartMode?: GcodeStartMode;
  readonly initialSavedOrigin?: SavedOrigin | null;
}

export function getStartModeStorageKey(): string {
  return 'laserforge_start_mode';
}

export function getSavedOriginStorageKey(): string {
  return 'laserforge_saved_origin';
}

function readStartMode(): GcodeStartMode {
  try {
    const raw = localStorage.getItem(getStartModeStorageKey());
    if (raw === 'absolute' || raw === 'current' || raw === 'savedOrigin') return raw;
  } catch {
    /* ignore */
  }
  return machineStartInitialState.startMode;
}

function readSavedOrigin(): SavedOrigin | null {
  try {
    const raw = localStorage.getItem(getSavedOriginStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedOrigin>;
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function persistStartMode(mode: GcodeStartMode): void {
  try {
    localStorage.setItem(getStartModeStorageKey(), mode);
  } catch {
    /* ignore */
  }
}

function persistSavedOrigin(origin: SavedOrigin | null): void {
  try {
    if (origin) {
      localStorage.setItem(getSavedOriginStorageKey(), JSON.stringify(origin));
    } else {
      localStorage.removeItem(getSavedOriginStorageKey());
    }
  } catch {
    /* ignore */
  }
}

function resolveInitialState(options?: CreateMachineStartStoreOptions): MachineStartState {
  return {
    ...machineStartInitialState,
    startMode: options?.initialStartMode ?? readStartMode(),
    savedOrigin: options?.initialSavedOrigin === undefined
      ? readSavedOrigin()
      : options.initialSavedOrigin
        ? { ...options.initialSavedOrigin }
        : null,
  };
}

export function createMachineStartStore(
  options?: CreateMachineStartStoreOptions,
): UseBoundStore<StoreApi<MachineStartStore>> {
  const initialState = resolveInitialState(options);
  return create<MachineStartStore>((set, get) => ({
    ...initialState,
    bumpProfileRevision: () => set((state) => ({ profileRevision: state.profileRevision + 1 })),
    setStartMode: (mode) => {
      persistStartMode(mode);
      set({ startMode: mode });
    },
    setSavedOrigin: (origin) => {
      const next = origin ? { ...origin } : null;
      persistSavedOrigin(next);
      set({ savedOrigin: next });
    },
    clearSavedOrigin: () => {
      persistSavedOrigin(null);
      set({ savedOrigin: null });
    },
    resetCurrentModeAfterDisconnect: () => {
      if (get().startMode === 'current') {
        persistStartMode('absolute');
        set({ startMode: 'absolute' });
      }
    },
    resetMachineStart: () => set(initialState),
  }));
}

export const useMachineStartStore = createMachineStartStore();
