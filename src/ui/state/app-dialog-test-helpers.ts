// Test helper: answers in-app dialogs (ADR-707) without mounting
// AppDialogHost, for flow tests that used to stub window.confirm.

import { useAppDialogStore, type AppDialogRequest } from './app-dialog-store';

/** true confirms, false or null cancels, a string is the prompt's text. */
export type AppDialogReply = boolean | string | null;

export type AppDialogResponder = {
  /** Every request seen, in the order it was asked. */
  readonly asked: ReadonlyArray<AppDialogRequest>;
  readonly stop: () => void;
};

/** Answers each request as soon as it is asked, as `reply` decides. */
export function answerAppDialogs(
  reply: (request: AppDialogRequest) => AppDialogReply,
): AppDialogResponder {
  const asked: AppDialogRequest[] = [];
  const drain = (): void => {
    for (;;) {
      const request = useAppDialogStore.getState().queue[0];
      if (request === undefined) return;
      asked.push(request);
      answer(request, reply(request));
    }
  };
  drain();
  return { asked, stop: useAppDialogStore.subscribe(drain) };
}

function answer(request: AppDialogRequest, reply: AppDialogReply): void {
  if (request.kind === 'confirm') {
    request.resolve({ confirmed: reply === true, dontAskAgain: false });
    return;
  }
  if (request.kind === 'prompt') {
    request.resolve(typeof reply === 'string' ? reply : null);
    return;
  }
  request.resolve();
}

/** Drops unanswered requests, so one test's question never reaches the next. */
export function clearAppDialogs(): void {
  useAppDialogStore.setState({ queue: [] });
}
