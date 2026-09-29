import type { Project } from '../../core/scene';
import type { importLightBurnProject } from '../../io/lightburn';
import type { deserializeProject } from '../../io/project';
import type { PlatformAdapter, RecentFileRef, SaveTarget } from '../../platform/types';
import { loadedMachineCapabilityWarningMessage } from '../machine/machine-capability-messages';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { ProjectMachineCapabilityLoadResult } from '../state/project-machine-capability';
import type { MarkLoadedOptions } from '../state/store-save-tracking-actions';
import type { ToastVariant } from '../state/toast-store';
import { clearAutosaveAfterFileHandoff } from './autosave-file-cleanup';
import { describeOpenResult } from './file-action-formatters';

export type ProjectOpenCompletionContext = {
  readonly setProject: (project: Project) => ProjectMachineCapabilityLoadResult;
  readonly markLoaded: (filename: string, options?: MarkLoadedOptions) => void;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
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
    markCapabilityAwareLoad(ctx, fileName, loadResult, saveTarget);
    clearAutosaveAfterFileHandoff(ctx.pushToast);
    const migration =
      result.migratedFrom === undefined ? '' : ` — migrated from schema v${result.migratedFrom}`;
    ctx.pushToast(
      `Opened ${fileName}${migration}`,
      result.migratedFrom === undefined ? 'success' : 'info',
    );
    reportMachineCapabilityRepair(loadResult, ctx.pushToast);
    return true;
  }
  if (result.kind === 'schema-too-new') {
    jobAwareAlert(
      `This project was saved with a newer KerfDesk (schemaVersion ${result.sawVersion}). Update the app to open it.`,
    );
    return false;
  }
  ctx.pushToast(`Could not open ${fileName}: ${describeOpenResult(result)}`, 'error');
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
  ctx.markLoaded(fileName.replace(/\.lbrn2?$/i, '.lf2'), { dirty: true });
  clearAutosaveAfterFileHandoff(ctx.pushToast);
  const unsupported = result.report.unsupportedShapeTypes.length;
  const warnings = result.report.warnings.length;
  ctx.pushToast(
    `Imported ${fileName}: ${result.report.importedObjects} objects, ${result.report.importedLayers} layers${unsupported + warnings === 0 ? '' : `, ${unsupported + warnings} warning(s)`}. Save as .lf2 to keep changes.`,
    unsupported + warnings === 0 ? 'success' : 'warning',
  );
  if (result.report.warnings.length > 0) {
    const visible = result.report.warnings.slice(0, 3);
    const remainder = result.report.warnings.length - visible.length;
    ctx.pushToast(
      `LightBurn settings review: ${visible.join(' ')}${remainder > 0 ? ` ${remainder} more warning(s) are in the import report.` : ''}`,
      'warning',
    );
  }
  reportMachineCapabilityRepair(loadResult, ctx.pushToast);
  return true;
}

function reportMachineCapabilityRepair(
  result: ProjectMachineCapabilityLoadResult,
  pushToast: ProjectOpenCompletionContext['pushToast'],
): void {
  if (result.kind !== 'capability-warning') return;
  pushToast(loadedMachineCapabilityWarningMessage(result.activeKind), 'warning');
}

function markCapabilityAwareLoad(
  ctx: ProjectOpenCompletionContext,
  filename: string,
  result: ProjectMachineCapabilityLoadResult,
  saveTarget: SaveTarget | null,
): void {
  const dirty = result.projectBedReconciled === true;
  if (saveTarget !== null) ctx.markLoaded(filename, dirty ? { dirty, saveTarget } : { saveTarget });
  else if (dirty) ctx.markLoaded(filename, { dirty: true });
  else ctx.markLoaded(filename);
}
