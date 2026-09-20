import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readWorkspaceLayoutPreference,
  useWorkspaceLayoutStore,
  WORKSPACE_LAYOUT_STORAGE_KEY,
} from './workspace-layout-store';

beforeEach(() => {
  localStorage.clear();
  useWorkspaceLayoutStore.setState({ preference: 'auto', resetRevision: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe('workspace layout preference', () => {
  it('remembers the chosen layout and restores auto on reset', () => {
    useWorkspaceLayoutStore.getState().setPreference('compact');
    expect(localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY)).toBe('compact');
    expect(readWorkspaceLayoutPreference()).toBe('compact');
    useWorkspaceLayoutStore.getState().reset();
    expect(readWorkspaceLayoutPreference()).toBe('auto');
    expect(useWorkspaceLayoutStore.getState().resetRevision).toBe(1);
  });

  it('ignores invalid stored preferences', () => {
    localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, 'other');
    expect(readWorkspaceLayoutPreference()).toBe('auto');
  });

  it('keeps layout selection usable when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(readWorkspaceLayoutPreference()).toBe('auto');
    useWorkspaceLayoutStore.getState().setPreference('spacious');
    expect(useWorkspaceLayoutStore.getState().preference).toBe('spacious');
  });
});
