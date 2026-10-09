import type { Project } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import type { AppState } from '../state/store';
import type {
  ProjectSaveWriteOwner,
  ProjectSaveOwnReplayResult,
} from '../state/project-save-write-coordinator';
import { errorMessage } from './file-action-formatters';
import { requestPersistentStorageOnce } from './persistent-storage-request';
import {
  completeProjectSave,
  failProjectSave,
  staleProjectSaveOutcome,
  type ProjectSaveOwner,
  type SaveProjectOutcome,
} from './project-save-completion';
import { handleSalvageExportProject, type SalvageExportCtx } from './salvage-export';
import { rememberRecentProject } from '../recent-projects/recent-project-record';
import { prepareProjectSave } from './prepare-project-save';
import { projectSaveNeedsWorker } from './project-save-size';
import { exportLargeProjectRecovery } from './large-project-recovery';
import { clearAutosaveAfterFileHandoff } from './autosave-file-cleanup';

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
    const prepared = await prepareProjectSave(ctx, owner, forceDialog);
    if (prepared.kind === 'stopped') return prepared.outcome;
    if (prepared.kind === 'invalid')
      return await handleInvalidProject(ctx, owner, writeOwner, prepared.reason);
    try {
      await writeOwner.write(prepared.target, prepared.json, (error, ownReplay) =>
        reportProjectSaveRestoreFailure(owner, prepared.target, error, ownReplay),
      );
      const outcome = completeProjectSave(owner, prepared.target, prepared.reuseTarget);
      rememberSavedProject(ctx.platform, prepared.target, outcome);
      return outcome;
    } catch (err) {
      return failProjectSave(owner, errorMessage(err));
    }
  } catch (error) {
    return failProjectSave(owner, errorMessage(error));
  } finally {
    writeOwner.release();
  }
}

// The captured bytes reached the file in both outcomes, newer edits or not.
function rememberSavedProject(
  platform: PlatformAdapter,
  target: SaveTarget,
  outcome: SaveProjectOutcome,
): void {
  if (outcome !== 'saved' && outcome !== 'saved-with-newer-edits') return;
  rememberRecentProject(platform, { name: target.displayName, recentRef: target.recentRef });
  // The operator saved on purpose, so ask the browser to keep the local stores
  // their work leans on (autosave, Recent Projects). Once per page session, and
  // nothing here waits for its answer.
  requestPersistentStorageOnce();
}

async function reportProjectSaveRestoreFailure(
  owner: ProjectSaveOwner,
  target: SaveTarget,
  error: unknown,
  ownReplay?: Promise<ProjectSaveOwnReplayResult>,
): Promise<void> {
  let failure = error;
  const markUncertain = () =>
    owner.markProjectSaveUncertain(
      owner.projectDocumentEpoch,
      owner.projectSaveRequestEpoch,
      target,
    );
  const marked =
    ownReplay === undefined
      ? await markUncertain()
      : await owner.markProjectSaveUncertain(
          owner.projectDocumentEpoch,
          owner.projectSaveRequestEpoch,
          target,
          {
            expectedProject: owner.expectedProject,
            completed: ownReplay.then((result) => result.kind === 'restored'),
            onRestored: () => clearAutosaveAfterFileHandoff(owner.pushToast),
          },
        );
  if (!marked) return;
  if (ownReplay !== undefined) {
    const result = await ownReplay;
    if (result.kind === 'restored') return;
    if (result.kind === 'failed') failure = result.error;
    // Supersession and own-replay failure are final for this restoration. Check
    // the saved owner again before emitting feedback or touching a newer handoff.
    if (!(await markUncertain())) return;
  }
  owner.pushToast(
    `Could not restore the newest project bytes to ${target.displayName}: ${errorMessage(failure)}. ` +
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
  const salvage: SalvageExportCtx = {
    platform: ctx.platform,
    project: ctx.project,
    savedName: ctx.savedName,
    pushToast: ctx.pushToast,
    isCurrent: () => staleProjectSaveOutcome(owner) === null,
    writeTarget: (target, contents) =>
      writeOwner.write(target, contents, (error, ownReplay) =>
        reportRecoveryRestoreFailure(owner, target, error, ownReplay),
      ),
  };
  if (projectSaveNeedsWorker(ctx.project)) await exportLargeProjectRecovery(ctx, owner, salvage);
  else await handleSalvageExportProject(salvage);
}

async function reportRecoveryRestoreFailure(
  owner: ProjectSaveOwner,
  target: SaveTarget,
  error: unknown,
  ownReplay?: Promise<ProjectSaveOwnReplayResult>,
): Promise<void> {
  if (ownReplay !== undefined && (await ownReplay).kind === 'restored') return;
  if (owner.getProjectDocumentEpoch() !== owner.projectDocumentEpoch) return;
  owner.pushToast(
    `Could not restore the newest recovery bytes to ${target.displayName}: ${errorMessage(error)}. ` +
      'That recovery copy is unreliable; export it again.',
    'error',
  );
}
