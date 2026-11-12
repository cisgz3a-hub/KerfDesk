import type { Project } from '../../core/scene';
import type { importLightBurnProject } from '../../io/lightburn';
import type { deserializeProject } from '../../io/project';
import type { PlatformAdapter, RecentFileRef, SaveTarget } from '../../platform/types';
import { loadedMachineCapabilityWarningMessage } from '../machine/machine-capability-messages';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { ProjectMachineCapabilityLoadResult } from '../state/project-machine-capability';
import type { MarkLoadedOptions } from '../state/store-save-tracking-actions';
import { pushFoldedNotice, type Notice } from '../state/folded-notice';
import type { ToastOptions, ToastVariant } from '../state/toast-store';
import { describePendingProProject } from '../state/pending-pro-project';
import { PROJECT_NOTICES_TOAST_KEY, projectLoadNotices } from '../state/project-load-notices';
import { missingFontOpenNotice } from '../text/missing-font-notice';
import { clearAutosaveAfterFileHandoff } from './autosave-file-cleanup';
import { projectOpenFailure } from './file-action-formatters';

export type ProjectOpenCompletionContext = {
  readonly setProject: (project: Project) => ProjectMachineCapabilityLoadResult;
  readonly markLoaded: (filename: string, options?: MarkLoadedOptions) => void;
  readonly pushToast: (message: string, variant?: ToastVariant, options?: ToastOptions) => void;
};

/** Where Save writes a KerfDesk project opened from `ref` (ADR-550), when the
 * platform can write it back. */
export function openedProjectSaveTarget(
  platform: PlatformAdapter,
  ref: RecentFileRef | undefined,
): SaveTarget | null {
  return ref === undefined ? null : (platform.openedProjectSaveTarget?.(ref) ?? null);
}

/** True when the file replaced the document. `saveTarget` is where Save then
 * writes: the opened file itself (ADR-550). */
export function completeNativeProjectOpen(
  ctx: ProjectOpenCompletionContext,
  fileName: string,
  result: ReturnType<typeof deserializeProject>,
  saveTarget: SaveTarget | null = null,
): boolean {
  if (result.kind === 'ok') {
    const loadResult = ctx.setProject(result.project);
    if (loadResult.kind === 'job-machine-locked') return false;
    if (loadResult.kind === 'desktop-required') {
      describePendingProProject(result.project, fileName);
      return false;
    }
    markCapabilityAwareLoad(ctx, fileName, loadResult, saveTarget);
    clearAutosaveAfterFileHandoff(ctx.pushToast);
    const migration =
      result.migratedFrom === undefined ? '' : ` — migrated from schema v${result.migratedFrom}`;
    const missingFonts = missingFontOpenNotice(result.project);
    // One toast: what the loader changed folds under "Opened", so a project
    // with many notes cannot push its first ones out unseen (A5-P2-6, ADR-708).
    pushFoldedNotice(
      ctx.pushToast,
      PROJECT_NOTICES_TOAST_KEY,
      {
        message: `Opened ${fileName}${migration}`,
        variant: result.migratedFrom === undefined ? 'success' : 'info',
      },
      [
        ...projectLoadNotices(result, { migration: false, project: result.project }),
        ...(missingFonts === null ? [] : [warning(missingFonts)]),
        ...machineCapabilityRepairNotes(loadResult),
      ],
    );
    return true;
  }
  if (result.kind === 'schema-too-new') {
    jobAwareAlert(
      `This project was saved with a newer KerfDesk (schemaVersion ${result.sawVersion}). Update the app to open it.`,
    );
    return false;
  }
  const failure = projectOpenFailure(fileName, result);
  ctx.pushToast(failure.message, 'error', { details: failure.details });
  return false;
}

/** True when the file replaced the document. */
export function completeLightBurnProjectOpen(
  ctx: ProjectOpenCompletionContext,
  fileName: string,
  result: ReturnType<typeof importLightBurnProject>,
): boolean {
  if (!result.ok) {
    ctx.pushToast(`Could not import ${fileName}: ${result.reason}`, 'error');
    return false;
  }
  const loadResult = ctx.setProject(result.project);
  if (loadResult.kind === 'job-machine-locked') return false;
  if (loadResult.kind === 'desktop-required') {
    describePendingProProject(result.project, fileName);
    return false;
  }
  ctx.markLoaded(fileName.replace(/\.lbrn2?$/i, '.lf2'), { dirty: true });
  clearAutosaveAfterFileHandoff(ctx.pushToast);
  // The report's warnings name every shape and setting left behind, the
  // unsupported shape types among them, and the project's notes keep the
  // whole report (ADR-388).
  const warnings = result.report.warnings.length;
  const visible = result.report.warnings.slice(0, 3);
  const remainder = warnings - visible.length;
  const review = `LightBurn import review: ${visible.join(' ')}${remainder > 0 ? ` ${remainder} more warning(s) are in the import report in Window > Project Notes.` : ''}`;
  pushFoldedNotice(
    ctx.pushToast,
    PROJECT_NOTICES_TOAST_KEY,
    {
      message: `Imported ${fileName}: ${result.report.importedObjects} objects, ${result.report.importedLayers} layers${warnings === 0 ? '' : `, ${warnings} warning(s)`}. Save as .lf2 to keep changes.`,
      variant: warnings === 0 ? 'success' : 'warning',
    },
    [...(warnings === 0 ? [] : [warning(review)]), ...machineCapabilityRepairNotes(loadResult)],
  );
  return true;
}

function warning(message: string): Notice {
  return { message, variant: 'warning' };
}

function machineCapabilityRepairNotes(
  result: ProjectMachineCapabilityLoadResult,
): ReadonlyArray<Notice> {
  return result.kind === 'capability-warning'
    ? [warning(loadedMachineCapabilityWarningMessage(result.activeKind))]
    : [];
}

function markCapabilityAwareLoad(
  ctx: ProjectOpenCompletionContext,
  filename: string,
  result: Exclude<
    ProjectMachineCapabilityLoadResult,
    { readonly kind: 'desktop-required' | 'job-machine-locked' }
  >,
  saveTarget: SaveTarget | null,
): void {
  const dirty = result.projectBedReconciled === true;
  if (saveTarget !== null) ctx.markLoaded(filename, dirty ? { dirty, saveTarget } : { saveTarget });
  else if (dirty) ctx.markLoaded(filename, { dirty: true });
  else ctx.markLoaded(filename);
}
