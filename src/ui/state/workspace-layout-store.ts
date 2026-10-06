import { create } from 'zustand';
import { saveComputerPreference } from './preference-persistence';

export type WorkspaceLayoutPreference = 'auto' | 'compact' | 'spacious';
export const WORKSPACE_LAYOUT_STORAGE_KEY = 'kerfdesk.workspace-layout.v1';

export function isWorkspaceLayoutPreference(value: unknown): value is WorkspaceLayoutPreference {
  return value === 'auto' || value === 'compact' || value === 'spacious';
}

export function readWorkspaceLayoutPreference(): WorkspaceLayoutPreference {
  try {
    const value = localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
    return isWorkspaceLayoutPreference(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

type WorkspaceLayoutState = {
  readonly preference: WorkspaceLayoutPreference;
  readonly resetRevision: number;
  readonly setPreference: (preference: WorkspaceLayoutPreference) => void;
  readonly reset: () => void;
};

function savePreference(preference: WorkspaceLayoutPreference): void {
  saveComputerPreference(WORKSPACE_LAYOUT_STORAGE_KEY, preference);
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>((set) => ({
  preference: readWorkspaceLayoutPreference(),
  resetRevision: 0,
  setPreference: (preference) => {
    savePreference(preference);
    set({ preference });
  },
  reset: () => {
    savePreference('auto');
    set((state) => ({ preference: 'auto', resetRevision: state.resetRevision + 1 }));
  },
}));
