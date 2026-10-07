import { createProject, EMPTY_SCENE, type Project } from '../../core/scene';
import type { ProjectSheetBook } from '../../core/scene/project-sheets';
import { deserializeProject, serializeProject } from '../../io/project';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { projectWithCurrentJobSetup } from './project-job-setup';
import { visitWorkflowArchives } from '../../io/project/project-workflow-archives';
import { useToastStore } from './toast-store';

type Set = (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
export type ProjectSheetActions = {
  readonly addProjectSheet: (name: string, duplicate: boolean) => string | null;
  readonly switchProjectSheet: (id: string) => boolean;
  readonly renameProjectSheet: (id: string, name: string) => void;
  readonly deleteInactiveProjectSheet: (id: string) => void;
};

export function projectSheetActions(set: Set, get: () => AppState): ProjectSheetActions {
  const replace = (project: Project): boolean => replaceSheetProject(set, get, project);
  return {
    addProjectSheet: (name, duplicate) => {
      const current = projectWithCurrentJobSetup(get());
      const book = current.sheetBook ?? {
        activeId: crypto.randomUUID(),
        activeName: 'Sheet 1',
        inactive: [],
      };
      if (name.trim() === '' || name.length > 200 || book.inactive.length >= 99) return null;
      const id = crypto.randomUUID();
      const next = duplicate ? duplicateSheet(current) : blankSheet(current);
      const sheetBook: ProjectSheetBook = {
        activeId: id,
        activeName: name.trim(),
        inactive: [...book.inactive, archiveCurrent(current, book)],
      };
      return replace({ ...next, sheetBook }) ? id : null;
    },
    switchProjectSheet: (id) => {
      const current = projectWithCurrentJobSetup(get());
      const book = current.sheetBook;
      const target = book?.inactive.find((sheet) => sheet.id === id);
      if (book === undefined || target === undefined) return false;
      const parsed = deserializeProject(target.projectJson);
      if (parsed.kind !== 'ok') return false;
      const sheetBook: ProjectSheetBook = {
        activeId: target.id,
        activeName: target.name,
        inactive: [
          ...book.inactive.filter((sheet) => sheet.id !== id),
          archiveCurrent(current, book),
        ],
      };
      return replace({ ...parsed.project, sheetBook });
    },
    renameProjectSheet: (id, name) =>
      set((state) => {
        const book = state.project.sheetBook;
        if (book === undefined || name.trim() === '' || name.length > 200) return {};
        const sheetBook = {
          ...book,
          activeName: book.activeId === id ? name.trim() : book.activeName,
          inactive: book.inactive.map((sheet) =>
            sheet.id === id ? { ...sheet, name: name.trim() } : sheet,
          ),
        };
        return {
          project: { ...state.project, sheetBook },
          undoStack: pushUndo(state.project, state.undoStack, 'Rename sheet'),
          redoStack: [],
          dirty: true,
        };
      }),
    deleteInactiveProjectSheet: (id) =>
      set((state) => {
        const book = state.project.sheetBook;
        if (book === undefined || !book.inactive.some((sheet) => sheet.id === id)) return {};
        return {
          project: {
            ...state.project,
            sheetBook: { ...book, inactive: book.inactive.filter((sheet) => sheet.id !== id) },
          },
          undoStack: pushUndo(state.project, state.undoStack, 'Delete sheet'),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}

function replaceSheetProject(set: Set, get: () => AppState, project: Project): boolean {
  const error = visitWorkflowArchives(project);
  if (error !== null) {
    useToastStore.getState().pushToast(error, 'warning');
    return false;
  }
  const previous = get();
  const outcome = previous.setProject(project);
  if (outcome.kind === 'desktop-required') return false;
  // Preserve this multi-sheet file's save destination; normal document
  // replacement resets Frame, pending work and selection to the new owner.
  set({ savedName: previous.savedName, lastSaveTarget: previous.lastSaveTarget, dirty: true });
  return true;
}

function archiveCurrent(
  project: Project,
  book: ProjectSheetBook,
): ProjectSheetBook['inactive'][number] {
  return {
    id: book.activeId,
    name: book.activeName,
    projectJson: serializeProject(withoutBook(project), { compact: true }),
  };
}
function withoutBook(project: Project): Project {
  const { sheetBook: _book, ...content } = project;
  return content;
}
/** Copy current artwork, including already fixed row text. The original run
 * and its observations stay archived; the copy requires a fresh explicit allocation. */
function duplicateSheet(project: Project): Project {
  const { productionManifest: _manifest, ...content } = withoutBook(project);
  return content;
}
function blankSheet(project: Project): Project {
  return {
    ...createProject(project.device),
    scene: EMPTY_SCENE,
    optimization: project.optimization,
    jobSetup: {
      ...project.jobSetup,
      outputScope: { cutSelectedGraphics: false, useSelectionOrigin: false, selectedObjectIds: [] },
    },
    ...(project.machine === undefined ? {} : { machine: project.machine }),
    ...(project.parkedCncMachine === undefined
      ? {}
      : { parkedCncMachine: project.parkedCncMachine }),
    ...(project.embeddedFonts === undefined ? {} : { embeddedFonts: project.embeddedFonts }),
    ...(project.variables === undefined ? {} : { variables: project.variables }),
  };
}
