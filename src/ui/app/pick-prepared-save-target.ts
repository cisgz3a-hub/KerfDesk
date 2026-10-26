import type { FileSaveRequest, PlatformAdapter, SaveTarget } from '../../platform/types';
import {
  useSaveReadyDialogStore,
  type SaveReadyDialogRequest,
} from '../state/save-ready-dialog-store';

export type PreparedSaveReady = {
  /** Title of the fresh-click dialog, e.g. "Save timelapse video". */
  readonly title: string;
  /** What is ready, e.g. "The timelapse video is ready." */
  readonly message: string;
};

/** Choose where to save output that is already complete (ADR-656).
 *
 * Chromium creates the chosen file, or empties an existing one, before its save
 * picker resolves, in the browser and in the desktop app alike. Nothing that can
 * fail or be cancelled may therefore run between this pick and the write that
 * follows it. The picker needs the click's transient activation, which slow
 * preparation outlasts; a fresh Choose file… click then opens it.
 *
 * Resolves null when the operator cancels, or when `signal` aborts before the
 * picker opens. Once the picker is open, its answer stands. */
export async function pickPreparedSaveTarget(
  platform: Pick<PlatformAdapter, 'pickFileForSave'>,
  saveRequest: FileSaveRequest,
  ready: PreparedSaveReady,
  signal?: AbortSignal,
): Promise<SaveTarget | null> {
  if (signal?.aborted === true) return null;
  if (hasPickerActivation()) return platform.pickFileForSave(saveRequest);
  return new Promise<SaveTarget | null>((resolve, reject) => {
    const store = useSaveReadyDialogStore.getState;
    let request: SaveReadyDialogRequest;
    const finish = (): void => {
      signal?.removeEventListener('abort', cancel);
      store().close(request);
    };
    const cancel = (): void => {
      if (request.phase === 'choosing') return;
      finish();
      resolve(null);
    };
    const choose = (): void => {
      if (request.phase !== 'ready') return;
      request = { ...request, phase: 'choosing' };
      store().show(request);
      // The platform opens its picker synchronously, inside this click.
      platform.pickFileForSave(saveRequest).then(
        (target) => {
          finish();
          resolve(target);
        },
        (error: unknown) => {
          finish();
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    };
    request = { ...ready, phase: 'ready', cancel, choose };
    signal?.addEventListener('abort', cancel, { once: true });
    store().show(request);
  });
}

function hasPickerActivation(): boolean {
  // Without the User Activation API, the picker itself decides.
  const activation = (navigator as Partial<Pick<Navigator, 'userActivation'>>).userActivation;
  return activation?.isActive !== false;
}
