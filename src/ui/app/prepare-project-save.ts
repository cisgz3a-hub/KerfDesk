import { prepareProjectForPersistence } from '../../io/project';
import type { SaveTarget } from '../../platform/types';
import { errorMessage } from './file-action-formatters';
import { prepareLargeProjectSave, type ProjectSaveTargetResult } from './large-project-save';
import type { SaveProjectCtx } from './project-save-action';
import {
  failProjectSave,
  type ProjectSaveOwner,
  type SaveProjectOutcome,
} from './project-save-completion';
import { projectSaveNeedsWorker } from './project-save-size';

type ProjectSavePreparationResult =
  | {
      readonly kind: 'ready';
      readonly json: string;
      readonly target: SaveTarget;
      readonly reuseTarget: boolean;
    }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'stopped'; readonly outcome: SaveProjectOutcome };

export async function prepareProjectSave(
  ctx: SaveProjectCtx,
  owner: ProjectSaveOwner,
  forceDialog: boolean,
): Promise<ProjectSavePreparationResult> {
  const reuseTarget = !forceDialog && ctx.lastSaveTarget !== null;
  if (projectSaveNeedsWorker(ctx.project)) {
    const result = await prepareLargeProjectSave(ctx, owner, reuseTarget, () =>
      projectSaveTarget(ctx, reuseTarget),
    );
    switch (result.kind) {
      case 'prepared':
        return selectedProjectSave(owner, result.json, result.target, reuseTarget);
      case 'invalid':
        return result;
      case 'failed':
        return { kind: 'stopped', outcome: failProjectSave(owner, result.reason) };
      case 'stale-document':
      case 'stale-request':
      case 'cancelled':
        return { kind: 'stopped', outcome: result.kind };
    }
  }
  const prepared = prepareProjectForPersistence(ctx.project);
  if (prepared.kind === 'invalid') return prepared;
  const target = await projectSaveTarget(ctx, reuseTarget);
  return selectedProjectSave(owner, prepared.json, target, reuseTarget);
}

function selectedProjectSave(
  owner: ProjectSaveOwner,
  json: string,
  target: ProjectSaveTargetResult,
  reuseTarget: boolean,
): ProjectSavePreparationResult {
  switch (target.kind) {
    case 'selected':
      return { kind: 'ready', json, target: target.target, reuseTarget };
    case 'failed':
      return { kind: 'stopped', outcome: failProjectSave(owner, target.message) };
    case 'cancelled':
      return { kind: 'stopped', outcome: 'cancelled' };
  }
}

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
