import { useCallback, useState } from 'react';

const STORAGE_KEY = 'laserforge_box_library_prefs_v1';

export interface PersistentBoxPreferences {
  lastPresetId?: string;
  lastCategory?: string;
  lastSearch?: string;
  lastKerf?: number;
  lastFitAllowance?: number;
}

function readPrefs(): PersistentBoxPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistentBoxPreferences;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePrefs(values: PersistentBoxPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Storage may be unavailable in privacy mode; keep the generator usable.
  }
}

export function usePersistentBoxPreferences(): {
  values: PersistentBoxPreferences;
  setValues: (partial: Partial<PersistentBoxPreferences>) => void;
} {
  const [values, setStoredValues] = useState<PersistentBoxPreferences>(() => readPrefs());
  const setValues = useCallback((partial: Partial<PersistentBoxPreferences>) => {
    setStoredValues(prev => {
      const next = { ...prev, ...partial };
      writePrefs(next);
      return next;
    });
  }, []);

  return { values, setValues };
}
