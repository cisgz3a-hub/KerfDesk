// What the operator is told when KerfDesk's page is hidden during a job
// (rolling audit v11 W9-P2-1, ADR-117 Amendment 1). A browser releases the
// screen wake lock whenever the page is hidden (a background tab, a minimised
// window) and refuses a new one until it is visible again (W3C Screen Wake
// Lock, request() step 5). Nothing else keeps a browser PC awake, so the
// computer can idle-sleep and stop the stream, and under GRBL M3 the beam
// stays on over the stopped head. The app cannot prevent that, so it says so:
// one Laser log line per job when the page is hidden, a "Keep visible" mark in
// the tab's title while it stays hidden, and a toast when the operator is back.

import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';

export const KEEP_AWAKE_HIDDEN_MESSAGE =
  '[lf2] Keep-awake paused: KerfDesk is in a background tab or minimised window, so the browser ' +
  'released its keep-awake. If the computer sleeps, the job stops, and a constant-power (M3) ' +
  'beam stays on over the stopped head. Bring KerfDesk back to the front, or turn off sleep in ' +
  'your power settings.';

export const KEEP_AWAKE_HIDDEN_TOAST =
  'KerfDesk was in the background during the job, so the browser let the computer sleep. ' +
  'Keep this tab in front until the job ends, or turn off sleep in your power settings.';

/** Prefixed to the tab title while a job runs in a hidden page. */
export const KEEP_VISIBLE_TITLE_MARK = '⚠ Keep visible — ';

export type HiddenJobKeepAwakeNotice = {
  /** The page is hidden during a job: log once per job, mark the title. */
  readonly noteHidden: () => void;
  /** The page is visible again during a job: unmark, and toast if it was hidden. */
  readonly noteVisible: () => void;
  /** A new job starts: it gets its own log line. */
  readonly reset: () => void;
  /** The job ended or the hook unmounted: unmark the title. */
  readonly clear: () => void;
};

export function createHiddenJobKeepAwakeNotice(doc: Document): HiddenJobKeepAwakeNotice {
  let logged = false;
  let hiddenSinceShown = false;

  const markTitle = (on: boolean): void => {
    const title = doc.title;
    const marked = title.startsWith(KEEP_VISIBLE_TITLE_MARK);
    if (on && !marked) doc.title = KEEP_VISIBLE_TITLE_MARK + title;
    if (!on && marked) doc.title = title.slice(KEEP_VISIBLE_TITLE_MARK.length);
  };

  return {
    noteHidden: () => {
      hiddenSinceShown = true;
      markTitle(true);
      if (logged) return;
      logged = true;
      useLaserStore.getState().pushSystemNotice(KEEP_AWAKE_HIDDEN_MESSAGE);
    },
    noteVisible: () => {
      markTitle(false);
      if (!hiddenSinceShown) return;
      hiddenSinceShown = false;
      useToastStore
        .getState()
        .pushToast(KEEP_AWAKE_HIDDEN_TOAST, 'warning', { key: 'keep-awake-hidden' });
    },
    reset: () => {
      logged = false;
      hiddenSinceShown = false;
    },
    clear: () => markTitle(false),
  };
}
