import { create } from 'zustand';

type TutorialState = {
  readonly isOpen: boolean;
  readonly tutorialId: string | null;
  readonly openTutorial: (id?: string) => void;
  readonly closeTutorial: () => void;
};

/** Learning has no dependency on project actions, the controller, or undo history. */
export const useTutorialStore = create<TutorialState>((set) => ({
  isOpen: false,
  tutorialId: null,
  openTutorial: (id) => set({ isOpen: true, tutorialId: id ?? null }),
  closeTutorial: () => set({ isOpen: false }),
}));
