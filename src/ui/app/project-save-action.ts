import type { Project } from '../../core/scene';
import { prepareProjectForPersistence } from '../../io/project';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import type { AppState } from '../state/store';
import type { ProjectSaveWriteOwner } from '../state/project-save-write-coordinator';
import { errorMessage } from './file-action-formatters';
import {
  completeProjectSave,
  failProjectSave,
  staleProjectSaveOutcome,
  type ProjectSaveOwner,
  type SaveProjectOutcome,
} from './project-save-completion';
import { handleSalvageExportProject } from './salvage-export';

export type SaveProjectCtx = Omit<ProjectSaveOwner, 'projectSaveRequestEpoch'> & {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  readonly lastSaveTarget: SaveTarget | null;
  readonly claimProjectSaveRequest: () => number;
  readonly projectSaveWriteCoordinator: AppState['projectSaveWriteCoordinator'];
};

/** Save with captured bytes, request-owned publication, and destination reconciliation. */
export async function handleSaveProject(
  ctx: SaveProjectCtx,
  forceDialog = false,
): Promise<SaveProjectOutcome> {
  const owner: ProjectSaveOwner = {
    ...ctx,
    projectSaveRequestEpoch: ctx.claimProjectSaveRequest(),
  };
  const writeOwner = ctx.projectSaveWriteCoordinator.begin(owner.projectSaveRequestEpoch);
  try {
    const prepared = prepareProjectForPersistence(ctx.project);
    if (prepared.kind !== 'ok') {
      const outcome = await handleInvalidProject(ctx, owner, writeOwner, prepared.reason);
      return outcome;
    }
    const reuseTarget = !forceDialog && ctx.lastSaveTarget !== null;
    const targetResult = await projectSaveTarget(ctx, reuseTarget);
    if (targetResult.kind === 'failed') return failProjectSave(owner, targetResult.message);
    if (targetResult.kind === 'cancelled') return 'cancelled';
    try {
      await writeOwner.write(targetResult.target, prepared.json, (error) =>
        reportProjectSaveRestoreFailure(owner, targetResult.target, error),
      );
      return completeProjectSave(owner, targetResult.target, reuseTarget);
    } catch (err) {
      return failProjectSave(owner, errorMessage(err));
    }
  } finally {
    writeOwner.release();
  }
}

async function reportProjectSaveRestoreFailure(
  owner: ProjectSaveOwner,
  target: SaveTarget,
  error: unknown,
): Promise<void> {
  if (
    !(await owner.markProjectSaveUncertain(
      owner.projectDocumentEpoch,
      owner.projectSaveRequestEpoch,
      target,
    ))
  ) {
    return;
  }
  owner.pushToast(
    `Could not restore the newest project bytes to ${target.displayName}: ${errorMessage(error)}. ` +
      'The project is unsaved; save it again.',
    'error',
  );
}

async function handleInvalidProject(
  ctx: SaveProjectCtx,
  owner: ProjectSaveOwner,
  writeOwner: ProjectSaveWriteOwner,
  reason: string,
): Promise<SaveProjectOutcome> {
  const outcome = failProjectSave(owner, reason);
  // The canonical save remains refused (ADR-204), but a separate raw copy
  // keeps the session recoverable without treating discard-before-close as clean.
  if (outcome === 'error') await offerSalvageExport(ctx, owner, writeOwner);
  return outcome;
}

type ProjectSaveTargetResult =
  | { readonly kind: 'selected'; readonly target: SaveTarget }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string };

async function projectSaveTarget(
  ctx: SaveProjectCtx,
  reuseTarget: boolean,
): Promise<ProjectSaveTargetResult> {
  try {
    const target = reuseTarget
      ? ctx.lastSaveTarget
      : await ctx.platform.pickFileForSave({
          suggestedName: ctx.savedName ?? 'untitled.lf2',
          extensions: ['.lf2'],
        });
    return target === null ? { kind: 'cancelled' } : { kind: 'selected', target };
  } catch (err) {
    return { kind: 'failed', message: errorMessage(err) };
  }
}

// jobAwareConfirm fails closed during an active job, so a refused canonical
// save never opens a recovery picker while machine work owns the UI.
async function offerSalvageExport(
  ctx: SaveProjectCtx,
  owner: ProjectSaveOwner,
  writeOwner: ProjectSaveWriteOwner,
): Promise<void> {
  const wantsSalvage = jobAwareConfirm(
    'This project cannot be saved as-is without changing its machine or output settings. ' +
      'Export a raw recovery copy to a new file instead? It preserves your work but may need ' +
      'repair before it reopens cleanly.',
  );
  if (!wantsSalvage) return;
  await handleSalvageExportProject({
    platform: ctx.platform,
    project: ctx.project,
    savedName: ctx.savedName,
    pushToast: ctx.pushToast,
    isCurrent: () => staleProjectSaveOutcome(owner) === null,
    writeTarget: (target, contents) =>
      writeOwner.write(target, contents, (error) =>
        reportRecoveryRestoreFailure(owner, target, error),
      ),
  });
}

function reportRecoveryRestoreFailure(
  owner: ProjectSaveOwner,
  target: SaveTarget,
  error: unknown,
): void {
  if (owner.getProjectDocumentEpoch() !== owner.projectDocumentEpoch) return;
  owner.pushToast(
    `Could not restore the newest recovery bytes to ${target.displayName}: ${errorMessage(error)}. ` +
      'That recovery copy is unreliable; export it again.',
    'error',
  );
}
