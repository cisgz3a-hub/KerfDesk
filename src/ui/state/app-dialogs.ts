// In-app confirm, alert and prompt (ADR-707): promise-based replacements for
// window.confirm / alert / prompt, drawn by AppDialogHost on the shared Dialog.
//
// A native box suspends the renderer, which is why job-aware-dialogs.ts
// refuses confirm and prompt during a job (PROJECT.md non-negotiable 9). These
// do not: the page keeps running, the Live Motion bar stays above the dialog
// and ABORT JOB stays clickable. So a question can be asked during a job,
// unless its caller says its yes must wait (`refuseDuringJob`).
//
// Because the page keeps running, the machine can change while a question is
// open. A caller whose yes sends a command must read the state again after the
// answer, never act on what it read before asking.

import {
  useAppDialogStore,
  type AppAlertOptions,
  type AppConfirmOptions,
  type AppPromptOptions,
} from './app-dialog-store';
import { dontAskAgainIsSet, rememberDontAskAgain } from './dont-ask-again';
import { isActiveJob } from './laser-store-helpers';
import { useLaserStore } from './laser-store';
import { useToastStore } from './toast-store';

export type { AppAlertOptions, AppConfirmOptions, AppPromptOptions } from './app-dialog-store';

/** True when the question is refused: a job is active and its caller named a
 *  refusal, which is shown as a toast. */
function refusedForJob(refusal: string | undefined): boolean {
  if (refusal === undefined || !isActiveJob(useLaserStore.getState().streamer)) return false;
  useToastStore.getState().pushToast(refusal, 'warning');
  return true;
}

/** Asks a yes/no question. Resolves true only for the named confirm button;
 *  Cancel, Escape and a refusal resolve false. */
export function appConfirm(options: AppConfirmOptions): Promise<boolean> {
  if (refusedForJob(options.refuseDuringJob)) return Promise.resolve(false);
  const rememberKey = options.dontAskAgainKey;
  if (rememberKey !== undefined && dontAskAgainIsSet(rememberKey)) return Promise.resolve(true);
  return new Promise((resolve) => {
    useAppDialogStore.getState().enqueue((id) => ({
      kind: 'confirm',
      id,
      options,
      resolve: (answer) => {
        useAppDialogStore.getState().remove(id);
        // A job that began while the question was open refuses it as well.
        if (answer.confirmed && refusedForJob(options.refuseDuringJob)) {
          resolve(false);
          return;
        }
        if (answer.confirmed && answer.dontAskAgain && rememberKey !== undefined) {
          rememberDontAskAgain(rememberKey);
        }
        resolve(answer.confirmed);
      },
    }));
  });
}

/** Shows a notice with one button. Resolves when it is closed. */
export function appAlert(options: AppAlertOptions): Promise<void> {
  return new Promise((resolve) => {
    useAppDialogStore.getState().enqueue((id) => ({
      kind: 'alert',
      id,
      options,
      resolve: () => {
        useAppDialogStore.getState().remove(id);
        resolve();
      },
    }));
  });
}

/** Asks for one line of text. Resolves the text as typed, or null on Cancel,
 *  Escape or a refusal. `validate` keeps the dialog open on a bad value. */
export function appPrompt(options: AppPromptOptions): Promise<string | null> {
  if (refusedForJob(options.refuseDuringJob)) return Promise.resolve(null);
  return new Promise((resolve) => {
    useAppDialogStore.getState().enqueue((id) => ({
      kind: 'prompt',
      id,
      options,
      resolve: (value) => {
        useAppDialogStore.getState().remove(id);
        if (value !== null && refusedForJob(options.refuseDuringJob)) {
          resolve(null);
          return;
        }
        resolve(value);
      },
    }));
  });
}

/**
 * Answers every waiting question as cancelled. AppDialogHost calls it when it
 * unmounts (a render crash replaces the workspace with the crash screen): a
 * question nobody can see must not keep its caller waiting, and is never a yes.
 */
export function cancelPendingAppDialogs(): void {
  for (const request of useAppDialogStore.getState().queue) {
    if (request.kind === 'confirm') request.resolve({ confirmed: false, dontAskAgain: false });
    else if (request.kind === 'prompt') request.resolve(null);
    else request.resolve();
  }
}
