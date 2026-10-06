import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREFERENCE_SAVE_WARNING,
  retryComputerPreferences,
  saveComputerPreference,
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
  const toasts = useToastStore.getState();
  for (const toast of toasts.toasts) toasts.dismissToast(toast.id);
  localStorage.clear();
});

describe('computer preference retries', () => {
  it('saves only the latest failed choice and runs only its successful follow-up', () => {
    const oldSaved = vi.fn();
    const latestSaved = vi.fn();
    const refused = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Synthetic preference refusal', 'QuotaExceededError');
    });
    expect(saveComputerPreference('test.choice', 'old', { onSaved: oldSaved })).toBe(false);
    expect(saveComputerPreference('test.choice', 'latest', { onSaved: latestSaved })).toBe(false);
    expect(oldSaved).not.toHaveBeenCalled();
    expect(latestSaved).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toMatchObject([{ message: PREFERENCE_SAVE_WARNING }]);
    refused.mockRestore();
    retryComputerPreferences();
    expect(localStorage.getItem('test.choice')).toBe('latest');
    expect(oldSaved).not.toHaveBeenCalled();
    expect(latestSaved).toHaveBeenCalledTimes(1);
    expect(usePreferencePersistenceStore.getState().pending.size).toBe(0);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('keeps a partial refusal visible without repeating already saved choices', () => {
    const refused = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Synthetic blocked storage');
    });
    saveComputerPreference('test.first', 'one');
    saveComputerPreference('test.second', 'two');
    refused.mockRestore();
    const original = Storage.prototype.setItem;
    const partial = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === 'test.second') throw new Error('One preference still refused');
      original.call(this, key, value);
    });
    retryComputerPreferences();
    expect(localStorage.getItem('test.first')).toBe('one');
    expect(localStorage.getItem('test.second')).toBeNull();
    expect([...usePreferencePersistenceStore.getState().pending.keys()]).toEqual(['test.second']);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    partial.mockRestore();
    const retried = vi.spyOn(Storage.prototype, 'setItem');
    retryComputerPreferences();
    expect(retried).toHaveBeenCalledTimes(1);
    expect(retried).toHaveBeenCalledWith('test.second', 'two');
    expect(localStorage.getItem('test.second')).toBe('two');
    expect(usePreferencePersistenceStore.getState().pending.size).toBe(0);
  });

  it('reacquires storage after its property getter becomes available', () => {
    const denied = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Synthetic denied getter', 'SecurityError');
    });
    expect(saveComputerPreference('test.getter', 'retained')).toBe(false);
    denied.mockRestore();
    retryComputerPreferences();
    expect(localStorage.getItem('test.getter')).toBe('retained');
    expect(usePreferencePersistenceStore.getState().pending.size).toBe(0);
  });
});
