import type { Project } from '../../core/scene';
import { MAX_EMBEDDED_FONTS } from '../../io/project/project-embedded-font-validator';
import { sceneLimitOverrun } from './scene-copy-room';
import { useToastStore } from './toast-store';
import { saveUndoStepName } from './undo-step-names';

class ProjectInsertionBudgetError extends Error {}

/** Validate the complete proposed edit before publishing any part of it. */
export function prepareProjectInsertion<T extends { readonly project?: Project }>(
  before: Project,
  prepare: () => T,
): T {
  const restoreUndoName = saveUndoStepName(before);
  try {
    const result = prepare();
    const after = result.project;
    if (after === undefined || after === before) return result;
    const error = sceneLimitOverrun(
      before.scene,
      after.scene,
      'Delete some artwork or unused operations first.',
    );
    if (error !== null) throw new ProjectInsertionBudgetError(error);
    const fonts = after.embeddedFonts?.length ?? 0;
    if (fonts > MAX_EMBEDDED_FONTS && fonts > (before.embeddedFonts?.length ?? 0)) {
      throw new ProjectInsertionBudgetError(
        `This would take the project past its limit of ${MAX_EMBEDDED_FONTS} imported fonts. Use a font already in the project.`,
      );
    }
    return result;
  } catch (error) {
    restoreUndoName();
    throw error;
  }
}

/** Canvas drawing and Paste have no asynchronous error handler. */
export function reportProjectInsertionFailure(insert: () => void): void {
  try {
    insert();
  } catch (error) {
    if (!(error instanceof ProjectInsertionBudgetError)) throw error;
    useToastStore.getState().pushToast(error.message, 'warning');
  }
}
