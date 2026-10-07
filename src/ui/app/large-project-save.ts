import type { SaveTarget } from '../../platform/types';
import { useStore } from '../state';
import {
  useProjectSaveDialogStore,
  type ProjectSaveDialogRequest,
} from '../state/project-save-dialog-store';
import type { SaveProjectCtx } from './project-save-action';
import { staleProjectSaveOutcome, type ProjectSaveOwner } from './project-save-completion';
import {
  prepareProjectSaveOffThread,
  type ProjectSavePreparation,
} from './project-save-preparation-client';

export type ProjectSaveTargetResult =
  | { readonly kind: 'selected'; readonly target: SaveTarget }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string };

type LargeProjectSaveResult =
  | { readonly kind: 'prepared'; readonly json: string; readonly target: ProjectSaveTargetResult }
  | Extract<ProjectSavePreparation, { readonly kind: 'invalid' | 'failed' }>
  | { readonly kind: 'cancelled' | 'stale-document' | 'stale-request' };

// A fresh Choose file click follows validation, so a slow worker never spends
// Chromium's transient picker activation. Already selected writes are still
// independent, even when a newer request or document owns the visible dialog.
export async function prepareLargeProjectSave(
  ctx: SaveProjectCtx,
  owner: ProjectSaveOwner,
  reuseTarget: boolean,
  pick: () => Promise<ProjectSaveTargetResult>,
  purpose: 'project' | 'recovery' = 'project',
): Promise<LargeProjectSaveResult> {
  const controller = new AbortController();
  let resolveTarget: ((target: ProjectSaveTargetResult) => void) | null = null;
  let request: ProjectSaveDialogRequest;
  const cancelledOutcome = (): LargeProjectSaveResult => ({
    kind: staleProjectSaveOutcome(owner) ?? 'cancelled',
  });
  const close = (): void => useProjectSaveDialogStore.getState().close(request);
  const cancel = (): void => {
    close();
    if (request.phase === 'choosing') return;
    controller.abort();
    resolveTarget?.({ kind: 'cancelled' });
  };
  const choose = (): void => {
    if (request.phase !== 'ready') return;
    if (staleProjectSaveOutcome(owner) !== null) {
      cancel();
      return;
    }
    request = { ...request, phase: 'choosing' };
    useProjectSaveDialogStore.getState().show(request);
    // pick() invokes the platform picker synchronously, before any await.
    void pick().then((target) => {
      close();
      resolveTarget?.(target);
    });
  };
  request = {
    phase: 'preparing',
    purpose,
    projectName: preparationName(ctx.savedName, purpose),
    cancel,
    choose,
  };
  if (!reuseTarget) useProjectSaveDialogStore.getState().show(request);
  const unsubscribe = useStore.subscribe(() => {
    if (!reuseTarget && staleProjectSaveOutcome(owner) !== null) cancel();
  });
  try {
    const prepared = await prepareProjectSaveOffThread(
      ctx.project,
      controller.signal,
      purpose === 'recovery' ? 'recovery' : 'canonical',
    );
    if (!reuseTarget && (controller.signal.aborted || staleProjectSaveOutcome(owner) !== null))
      return cancelledOutcome();
    if (prepared.kind !== 'ok') return prepared;
    if (reuseTarget) return { kind: 'prepared', json: prepared.json, target: await pick() };
    const target = new Promise<ProjectSaveTargetResult>((resolve) => {
      resolveTarget = resolve;
    });
    request = { ...request, phase: 'ready' };
    useProjectSaveDialogStore.getState().show(request);
    const selected = await target;
    if (controller.signal.aborted) return cancelledOutcome();
    return { kind: 'prepared', json: prepared.json, target: selected };
  } catch (error) {
    if (controller.signal.aborted) return cancelledOutcome();
    throw error;
  } finally {
    unsubscribe();
    close();
  }
}

function preparationName(savedName: string | null, purpose: 'project' | 'recovery'): string {
  return purpose === 'recovery' ? 'raw recovery copy' : (savedName ?? 'untitled.lf2');
}
