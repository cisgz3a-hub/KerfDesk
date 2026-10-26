import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AUTO_CONNECT_STORAGE_KEY,
  loadAutoConnectPreference,
  saveAutoConnectPreference,
} from './serial-port-memory';
import {
  PREFERENCE_SAVE_WARNING,
  retryComputerPreferences,
  usePreferencePersistenceStore,
} from './preference-persistence';
import { useToastStore } from './toast-store';

beforeEach(() => {
  localStorage.clear();
  usePreferencePersistenceStore.setState({ pending: new Map() });
});
afterEach(() => {
  vi.restoreAllMocks();
  usePreferencePersistenceStore.setState({ pending: new Map() });
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
  localStorage.clear();
});

it('warns on refusal, honours the current choice in-session, and retries only the latest value', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Synthetic quota refusal', 'QuotaExceededError');
  });
  saveAutoConnectPreference(undefined, false);
  expect(localStorage.getItem(AUTO_CONNECT_STORAGE_KEY)).toBeNull();
  expect(
    useToastStore.getState().toasts.some((toast) => toast.message === PREFERENCE_SAVE_WARNING),
  ).toBe(true);
  expect(loadAutoConnectPreference(localStorage)).toBe(false);
  saveAutoConnectPreference(undefined, true);
  saveAutoConnectPreference(undefined, false);
  expect(usePreferencePersistenceStore.getState().pending.size).toBe(1);
  setItem.mockRestore();
  retryComputerPreferences();
  expect(localStorage.getItem(AUTO_CONNECT_STORAGE_KEY)).toBe('off');
  expect(usePreferencePersistenceStore.getState().pending.size).toBe(0);
  expect(loadAutoConnectPreference(localStorage)).toBe(false);
});

it('can retry after the storage getter was denied', () => {
  const denied = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Synthetic denial', 'SecurityError');
  });
  saveAutoConnectPreference(undefined, false);
  denied.mockRestore();
  retryComputerPreferences();
  expect(localStorage.getItem(AUTO_CONNECT_STORAGE_KEY)).toBe('off');
});
