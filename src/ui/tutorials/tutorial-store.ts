import { create } from 'zustand';

type TutorialState = {
  readonly isOpen: boolean;
  readonly tutorialId: string | null;
  /** Lessons opened before this one, so "Learn next" can be walked back. */
  readonly trail: readonly string[];
  readonly openTutorial: (id?: string) => void;
  readonly closeTutorial: () => void;
  /** One level out: the previous lesson if there is one, otherwise the library. */
  readonly goBack: () => void;
};

/** Learning has no dependency on project actions, the controller, or undo history. */
export const useTutorialStore = create<TutorialState>((set) => ({
  isOpen: false,
  tutorialId: null,
  trail: [],
  openTutorial: (id) =>
    set((state) =>
      id === undefined || id === state.tutorialId
        ? { isOpen: true, tutorialId: id ?? null, trail: [] }
        : {
            isOpen: true,
            tutorialId: id,
            trail: state.tutorialId === null ? [] : [...state.trail, state.tutorialId],
          },
    ),
  closeTutorial: () => set({ isOpen: false, tutorialId: null, trail: [] }),
  goBack: () =>
    set((state) => {
      const previous = state.trail.at(-1);
      return previous === undefined
        ? { tutorialId: null, trail: [] }
        : { tutorialId: previous, trail: state.trail.slice(0, -1) };
    }),
}));
