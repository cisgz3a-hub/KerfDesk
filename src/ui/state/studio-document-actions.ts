import type { StudioDocument } from '../../core/scene/studio-document';
import type { Project } from '../../core/scene';
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
        const project = projectWithStudioDocument(state.project, document);
        applied = true;
        if (project === state.project) return {};
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

/** Validate the complete candidate before any source or artwork can be committed. */
export function projectWithStudioDocument(project: Project, document: StudioDocument): Project {
  const documents = project.studioDocuments ?? [];
  const previous = documents.find((entry) => entry.id === document.id);
  if (previous !== undefined && sameDocument(previous, document)) return project;
  const saved = { ...document };
  const studioDocuments =
    previous === undefined
      ? [...documents, saved]
      : documents.map((entry) => (entry.id === saved.id ? saved : entry));
  const next = { ...project, studioDocuments };
  const error = validateProjectStudioDocuments(next);
  if (error !== null) throw new Error(error);
  return next;
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
