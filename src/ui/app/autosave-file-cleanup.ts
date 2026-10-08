import type { Project } from '../../core/scene';
import { projectAutosaveService, type AutosaveDurableClearResult } from '../state/autosave-durable';
import type { ToastVariant } from '../state/toast-store';

export const AUTOSAVE_FILE_CLEANUP_WARNING =
  'The project handoff succeeded, but an older recovery snapshot could not be cleared and may appear again.';

type PushToast = (message: string, variant?: ToastVariant) => void;
type AutosaveClearService = {
  clearCurrent(): Promise<AutosaveDurableClearResult>;
};
const pendingDiscards = new WeakMap<Project, Set<() => boolean>>();

export function isAutosaveDiscardPending(project: Project): boolean {
  for (const isCurrent of pendingDiscards.get(project) ?? []) {
    if (isCurrent()) return true;
  }
  return false;
}

export function clearAutosaveAfterFileHandoff(
  pushToast: PushToast,
  service: AutosaveClearService = projectAutosaveService,
): void {
  void clearCurrentWithWarning(pushToast, service);
}

/** Stop this exact discarded revision being queued behind its owned clear.
 * Edits create a different Project, retain autosave, and retire the handoff. */
export async function clearAutosaveForDiscard(
  project: Project,
  isCurrent: () => boolean,
  pushToast: PushToast,
  service: AutosaveClearService = projectAutosaveService,
): Promise<void> {
  const owners = pendingDiscards.get(project) ?? new Set<() => boolean>();
  owners.add(isCurrent);
  pendingDiscards.set(project, owners);
  try {
    await clearCurrentWithWarning(pushToast, service);
  } finally {
    owners.delete(isCurrent);
    if (owners.size === 0) pendingDiscards.delete(project);
  }
}

async function clearCurrentWithWarning(
  pushToast: PushToast,
  service: AutosaveClearService,
): Promise<void> {
  let result: AutosaveDurableClearResult;
  try {
    // Begin synchronously so the durable queue orders cleanup before any
    // subsequent document's interval write.
    result = await service.clearCurrent();
  } catch {
    pushToast(AUTOSAVE_FILE_CLEANUP_WARNING, 'warning');
    return;
  }
  if (result.kind !== 'ok') pushToast(AUTOSAVE_FILE_CLEANUP_WARNING, 'warning');
}
