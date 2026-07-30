import type {
  ImportWorkerProgress,
  ImportWorkerRequestOptions,
} from '../import/import-worker-client';
import type { ToastVariant } from '../state/toast-store';

type PushToast = (message: string, variant?: ToastVariant) => void;

export type ImportWorkerControls = {
  readonly options: ImportWorkerRequestOptions;
  readonly dispose: () => void;
};

export function createImportWorkerControls(
  name: string,
  pushToast: PushToast,
): ImportWorkerControls {
  const controller = new AbortController();
  let lastProgress = '';
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') controller.abort();
  };
  window.addEventListener('keydown', handleKeyDown);
  const onProgress = (progress: ImportWorkerProgress): void => {
    const key = `${progress.phase}:${progress.queuePosition}`;
    if (key === lastProgress) return;
    lastProgress = key;
    pushToast(progressMessage(name, progress), 'info');
  };
  return {
    options: { signal: controller.signal, onProgress },
    dispose: () => window.removeEventListener('keydown', handleKeyDown),
  };
}

export function isImportCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function progressMessage(name: string, progress: ImportWorkerProgress): string {
  if (progress.phase === 'queued') {
    return `${name}: queued behind ${progress.queuePosition} import(s). Press Esc to cancel.`;
  }
  if (progress.phase === 'reading') return `${name}: reading in worker. Press Esc to cancel.`;
  if (progress.phase === 'parsing') return `${name}: parsing in worker. Press Esc to cancel.`;
  return `${name}: preparing relief in worker. Press Esc to cancel.`;
}
