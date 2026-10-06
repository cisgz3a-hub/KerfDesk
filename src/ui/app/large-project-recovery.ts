import { errorMessage } from './file-action-formatters';
import { prepareLargeProjectSave, type ProjectSaveTargetResult } from './large-project-save';
import type { SaveProjectCtx } from './project-save-action';
import { staleProjectSaveOutcome, type ProjectSaveOwner } from './project-save-completion';
import { handleSalvageExportProject, recoveryName, type SalvageExportCtx } from './salvage-export';

// The operator already accepted the raw recovery confirmation. Prepare only
// the same raw serializer bytes, then choose a separate target with a fresh
// click; this path cannot mark the canonical project saved.
export async function exportLargeProjectRecovery(
  ctx: SaveProjectCtx,
  owner: ProjectSaveOwner,
  salvage: SalvageExportCtx,
): Promise<void> {
  const prepared = await prepareLargeProjectSave(
    ctx,
    owner,
    false,
    () => pickRecovery(ctx),
    'recovery',
  );
  if (prepared.kind === 'prepared') {
    if (prepared.target.kind === 'selected') {
      await handleSalvageExportProject(salvage, {
        project: ctx.project,
        raw: prepared.json,
        target: prepared.target.target,
      });
    } else if (prepared.target.kind === 'failed')
      reportFailure(ctx, owner, prepared.target.message);
  } else if (prepared.kind === 'failed' || prepared.kind === 'invalid') {
    reportFailure(ctx, owner, prepared.reason);
  }
}

async function pickRecovery(ctx: SaveProjectCtx): Promise<ProjectSaveTargetResult> {
  try {
    const target = await ctx.platform.pickFileForSave({
      suggestedName: recoveryName(ctx.savedName),
      extensions: ['.lf2'],
    });
    return target === null ? { kind: 'cancelled' } : { kind: 'selected', target };
  } catch (error) {
    return { kind: 'failed', message: errorMessage(error) };
  }
}

function reportFailure(ctx: SaveProjectCtx, owner: ProjectSaveOwner, message: string): void {
  if (staleProjectSaveOutcome(owner) !== null) return;
  ctx.pushToast(`Could not export a recovery copy: ${message}`, 'error');
}
