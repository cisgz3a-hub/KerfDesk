import { create } from 'zustand';
import { browserLocalStorage } from './browser-local-storage';
import { useToastStore } from './toast-store';

type PreferenceWriteOptions = {
  readonly storage?: Pick<Storage, 'setItem'> | null | undefined;
  readonly onSaved?: (() => void) | undefined;
};

type PendingPreferenceWrite = {
  readonly value: string;
  readonly options: PreferenceWriteOptions;
};

type PreferencePersistenceState = {
  readonly pending: ReadonlyMap<string, PendingPreferenceWrite>;
};

export const PREFERENCE_SAVE_WARNING =
  'Some settings could not be saved. Open Settings to retry before closing KerfDesk.';

export const usePreferencePersistenceStore = create<PreferencePersistenceState>(() => ({
  pending: new Map(),
}));

/** Keep only the latest requested value for each computer-local preference. */
export function saveComputerPreference(
  key: string,
  value: string,
  options: PreferenceWriteOptions = {},
): boolean {
  return attemptWrite(key, { value, options });
}

export function hasPendingComputerPreference(key: string): boolean {
  return usePreferencePersistenceStore.getState().pending.has(key);
}

/** Explicit retry reacquires browser storage, including a previously denied getter. */
export function retryComputerPreferences(): void {
  for (const [key, write] of usePreferencePersistenceStore.getState().pending) {
    if (usePreferencePersistenceStore.getState().pending.get(key) === write) {
      attemptWrite(key, write);
    }
  }
}

function attemptWrite(key: string, write: PendingPreferenceWrite): boolean {
  try {
    const storage =
      write.options.storage === undefined ? browserLocalStorage() : write.options.storage;
    if (storage === null) throw new Error('Preference storage unavailable');
    storage.setItem(key, write.value);
  } catch {
    const current = usePreferencePersistenceStore.getState().pending;
    const pending = new Map(current);
    pending.set(key, write);
    usePreferencePersistenceStore.setState({ pending });
    if (current.size === 0) useToastStore.getState().pushToast(PREFERENCE_SAVE_WARNING, 'warning');
    return false;
  }
  const current = usePreferencePersistenceStore.getState().pending;
  if (current.has(key)) {
    const pending = new Map(current);
    pending.delete(key);
    usePreferencePersistenceStore.setState({ pending });
    if (pending.size === 0) {
      const toasts = useToastStore.getState();
      for (const toast of toasts.toasts) {
        if (toast.message === PREFERENCE_SAVE_WARNING) toasts.dismissToast(toast.id);
      }
    }
  }
  write.options.onSaved?.();
  return true;
}
