import type { StudioDocument } from '../../core/scene/studio-document';
import { validateProjectStudioDocuments } from '../../io/project/project-studio-document-validator';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

type Set = (patch: (state: AppState) => Partial<AppState>) => void;
export type StudioDocumentActions = {
  /** Returns false for a replaced project; invalid native metadata throws before any mutation. */
  readonly upsertStudioDocument: (
    document: StudioDocument,
    expectedProjectDocumentEpoch: number,
  ) => boolean;
};

export function studioDocumentActions(set: Set): StudioDocumentActions {
  return {
    upsertStudioDocument: (document, expectedEpoch) => {
      let applied = false;
      set((state) => {
        if (state.projectDocumentEpoch !== expectedEpoch) return {};
        const documents = state.project.studioDocuments ?? [];
        const previous = documents.find((entry) => entry.id === document.id);
        const saved = { ...document };
        const studioDocuments =
          previous === undefined
            ? [...documents, saved]
            : documents.map((entry) => (entry.id === saved.id ? saved : entry));
        const project = { ...state.project, studioDocuments };
        const error = validateProjectStudioDocuments(project);
        if (error !== null) throw new Error(error);
        applied = true;
        if (previous !== undefined && sameDocument(previous, saved)) return {};
        return {
          project,
          undoStack: pushUndo(state.project, state.undoStack, 'Save studio document'),
          redoStack: [],
          dirty: true,
        };
      });
      return applied;
    },
  };
}

function sameDocument(left: StudioDocument, right: StudioDocument): boolean {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (key) =>
        key === 'revision' ||
        left[key as keyof StudioDocument] === right[key as keyof StudioDocument],
    )
  );
}
