// Display units (ADR-629): millimetres or inches on screen. An app preference
// kept on this computer, like the nudge distances: never in the project file,
// so a shared project never changes another operator's units. The project,
// profiles and G-code stay in millimetres; only shown and typed numbers convert.

import { create } from 'zustand';
import type { DisplayLengthUnit } from '../display-length';
import { browserLocalStorage } from './browser-local-storage';
import { hasPendingComputerPreference, saveComputerPreference } from './preference-persistence';

export const DISPLAY_UNITS_KEY = 'kerfdesk.display-units.v1';
export const DEFAULT_DISPLAY_UNIT: DisplayLengthUnit = 'mm';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function normalizeDisplayUnit(value: unknown): DisplayLengthUnit {
  return value === 'in' ? 'in' : DEFAULT_DISPLAY_UNIT;
}

export function readDisplayUnit(
  storage: PreferenceStorage | null = browserLocalStorage(),
): DisplayLengthUnit {
  try {
    return normalizeDisplayUnit(storage?.getItem(DISPLAY_UNITS_KEY));
  } catch {
    return DEFAULT_DISPLAY_UNIT;
  }
}

type DisplayUnitsState = {
  readonly lengthUnit: DisplayLengthUnit;
  readonly setLengthUnit: (unit: DisplayLengthUnit) => void;
};

export const useDisplayUnitsStore = create<DisplayUnitsState>((set) => ({
  lengthUnit: readDisplayUnit(),
  setLengthUnit: (unit) =>
    set((state) => {
      const next = normalizeDisplayUnit(unit);
      if (next === state.lengthUnit && !hasPendingComputerPreference(DISPLAY_UNITS_KEY)) {
        return state;
      }
      saveComputerPreference(DISPLAY_UNITS_KEY, next);
      return next === state.lengthUnit ? state : { lengthUnit: next };
    }),
}));

/** The operator's chosen length unit; re-renders when it changes. */
export function useLengthUnit(): DisplayLengthUnit {
  return useDisplayUnitsStore((state) => state.lengthUnit);
}
