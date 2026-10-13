// Opens the Project Notes dialog when a project that asks for it is opened
// (LightBurn Show Notes "show on open"). A project is opened whenever the
// document epoch changes, and once for the project present at start-up.

import { useEffect } from 'react';
import { useStore } from '../state';

export function useShowNotesOnOpen(open: () => void): void {
  useEffect(() => {
    const wantsNotes = (): boolean => {
      const project = useStore.getState().project;
      return project.showNotesOnOpen === true && project.notes.trim() !== '';
    };
    if (wantsNotes()) open();
    let epoch = useStore.getState().projectDocumentEpoch;
    return useStore.subscribe((state) => {
      if (state.projectDocumentEpoch === epoch) return;
      epoch = state.projectDocumentEpoch;
      if (wantsNotes()) open();
    });
  }, [open]);
}
