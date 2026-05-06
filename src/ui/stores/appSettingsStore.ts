import { create, type StoreApi, type UseBoundStore } from 'zustand';

// T2-6: persistent app-level preferences that App.tsx should consume but not own.
export interface AppSettingsState {
  productionMode: boolean;
}

export interface AppSettingsActions {
  setProductionMode: (enabled: boolean) => void;
  resetSettings: () => void;
}

export type AppSettingsStore = AppSettingsState & AppSettingsActions;

export const appSettingsInitialState: AppSettingsState = {
  productionMode: false,
};

export interface CreateAppSettingsStoreOptions {
  readonly initialProductionMode?: boolean;
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

function resolveInitialState(options?: CreateAppSettingsStoreOptions): AppSettingsState {
  return {
    ...appSettingsInitialState,
    productionMode: options?.initialProductionMode ?? shouldEnableProductionModeByDefault(),
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
    resetSettings: () => set(initialState),
  }));
}

export const useAppSettingsStore = createAppSettingsStore();
