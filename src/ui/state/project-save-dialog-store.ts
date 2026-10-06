import { create } from 'zustand';

export type ProjectSaveDialogRequest = {
  readonly purpose: 'project' | 'recovery';
  readonly phase: 'preparing' | 'ready' | 'choosing';
  readonly projectName: string;
  readonly cancel: () => void;
  readonly choose: () => void;
};

type ProjectSaveDialogState = {
  readonly request: ProjectSaveDialogRequest | null;
  readonly show: (request: ProjectSaveDialogRequest) => void;
  readonly close: (request: ProjectSaveDialogRequest) => void;
};

export const useProjectSaveDialogStore = create<ProjectSaveDialogState>((set, get) => ({
  request: null,
  show: (request) => {
    const previous = get().request;
    if (previous !== null && previous.cancel !== request.cancel) previous.cancel();
    set({ request });
  },
  close: (request) => {
    if (get().request?.cancel === request.cancel) set({ request: null });
  },
}));
