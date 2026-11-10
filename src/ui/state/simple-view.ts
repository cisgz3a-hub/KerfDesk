// Simple view (ADR-698): a computer preference, like display units, that hides
// the laser operation settings a first job does not need. It changes only what
// the inspector shows: never a stored value, the project file, Job Review, the
// run controls or G-code. A hidden setting whose value is not the default stays
// visible as a value (see simple-view-hidden-values.ts), and "Show all
// settings" turns the view off.

import { create } from 'zustand';
import { browserLocalStorage } from './browser-local-storage';
import { hasPendingComputerPreference, saveComputerPreference } from './preference-persistence';

export const SIMPLE_VIEW_KEY = 'kerfdesk.simple-view.v1';

type PreferenceStorage = Pick<Storage, 'getItem'>;

/** Off unless this computer saved "on": existing operators see no change. */
export function readSimpleView(storage: PreferenceStorage | null = browserLocalStorage()): boolean {
  try {
    return storage?.getItem(SIMPLE_VIEW_KEY) === 'on';
  } catch {
    return false;
  }
}

type SimpleViewState = {
  readonly enabled: boolean;
  readonly setEnabled: (enabled: boolean) => void;
  readonly toggle: () => void;
};

export const useSimpleViewStore = create<SimpleViewState>((set, get) => ({
  enabled: readSimpleView(),
  setEnabled: (enabled) =>
    set((state) => {
      if (enabled === state.enabled && !hasPendingComputerPreference(SIMPLE_VIEW_KEY)) {
        return state;
      }
      saveComputerPreference(SIMPLE_VIEW_KEY, enabled ? 'on' : 'off');
      return enabled === state.enabled ? state : { enabled };
    }),
  toggle: () => get().setEnabled(!get().enabled),
}));

/** True while Simple view hides advanced operation settings. */
export function useSimpleView(): boolean {
  return useSimpleViewStore((state) => state.enabled);
}
