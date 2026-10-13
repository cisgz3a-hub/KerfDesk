// Opt-in: saved layer defaults also seed operations in new projects and after
// a restart (LightBurn applies saved defaults to every new layer). Off by
// default, so New and restart keep the app's starter values unless the
// operator chooses otherwise. Kept per computer, never in a project.

import { create } from 'zustand';

const KEY = 'lf2:layer-defaults-auto-apply:v1';

function read(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

type LayerDefaultsPreference = {
  readonly autoApply: boolean;
  readonly setAutoApply: (autoApply: boolean) => void;
};

export const useLayerDefaultsPreference = create<LayerDefaultsPreference>((set) => ({
  autoApply: read(),
  setAutoApply: (autoApply) => {
    set({ autoApply });
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, String(autoApply));
    } catch {
      // Storage may be blocked; the choice still holds for this session.
    }
  },
}));

/** Whether a fresh document or session starts with saved defaults applied. */
export function layerDefaultsAutoApply(): boolean {
  return useLayerDefaultsPreference.getState().autoApply;
}
