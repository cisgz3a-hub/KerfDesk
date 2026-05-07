import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  getDefaultUserMode,
  getUserModeStorageKey,
  isUserMode,
  type UserMode,
} from '../../app/UserModeGates';

// T2-6: persistent app-level preferences that App.tsx should consume but not own.
export interface AppSettingsState {
  productionMode: boolean;
  userMode: UserMode;
}

export interface AppSettingsActions {
  setProductionMode: (enabled: boolean) => void;
  setUserMode: (mode: UserMode) => void;
  resetSettings: () => void;
}

export type AppSettingsStore = AppSettingsState & AppSettingsActions;

export const appSettingsInitialState: AppSettingsState = {
  productionMode: false,
  userMode: getDefaultUserMode(),
};

export interface CreateAppSettingsStoreOptions {
  readonly initialProductionMode?: boolean;
  readonly initialUserMode?: UserMode;
}

export function getProductionModeStorageKey(): string {
  return 'laserforge_production_mode';
}

export function shouldEnableProductionModeByDefault(): boolean {
  try {
    return localStorage.getItem(getProductionModeStorageKey()) === 'true';
  } catch {
    return false;
  }
}

function persistProductionMode(enabled: boolean): void {
  try {
    localStorage.setItem(getProductionModeStorageKey(), enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export { getUserModeStorageKey };

export function readPersistedUserMode(): UserMode {
  try {
    const value = localStorage.getItem(getUserModeStorageKey());
    return isUserMode(value) ? value : getDefaultUserMode();
  } catch {
    return getDefaultUserMode();
  }
}

function persistUserMode(mode: UserMode): void {
  try {
    localStorage.setItem(getUserModeStorageKey(), mode);
  } catch {
    /* ignore */
  }
}

function resolveInitialState(options?: CreateAppSettingsStoreOptions): AppSettingsState {
  return {
    ...appSettingsInitialState,
    productionMode: options?.initialProductionMode ?? shouldEnableProductionModeByDefault(),
    userMode: options?.initialUserMode ?? readPersistedUserMode(),
  };
}

export function createAppSettingsStore(
  options?: CreateAppSettingsStoreOptions,
): UseBoundStore<StoreApi<AppSettingsStore>> {
  const initialState = resolveInitialState(options);
  return create<AppSettingsStore>((set) => ({
    ...initialState,
    setProductionMode: (enabled) => {
      persistProductionMode(enabled);
      set({ productionMode: enabled });
    },
    setUserMode: (mode) => {
      persistUserMode(mode);
      set({ userMode: mode });
    },
    resetSettings: () => set(initialState),
  }));
}

export const useAppSettingsStore = createAppSettingsStore();
