// Windows restarting, shutting down or signing out during a job (ADR-548).
// The window tells the main process whether a job runs. Main asks Windows to
// wait and tells the window, which says so in a notice; when Windows ends the
// session anyway, the window sends the same Abort as closing KerfDesk.

import { create } from 'zustand';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { desktopCloseController } from './desktop-close-runtime';

export type SessionEndPhase = 'asked' | 'ending';

export const SESSION_END_EVENT = 'kerfdesk:session-end';

export const SESSION_END_MESSAGES: Readonly<Record<SessionEndPhase, string>> = {
  asked:
    'Windows wants to restart, shut down or sign out while a job runs, and KerfDesk asked it to wait. ' +
    'Let the job finish or Abort it before you restart. If Windows restarts anyway, KerfDesk sends Abort first.',
  ending:
    'Windows is ending this session during the job, so KerfDesk sent Abort. A sent Abort does not confirm ' +
    'the machine stopped: use the physical E-stop or power cutoff if it may still be running.',
};

type SessionEndState = {
  readonly phase: SessionEndPhase | null;
  readonly dismiss: () => void;
};

export const useSessionEndStore = create<SessionEndState>((set) => ({
  phase: null,
  dismiss: () => set({ phase: null }),
}));

/** A job, or a latched Fire, that ending the session would cut off. */
export function jobWouldBeCutOff(laser: ReturnType<typeof useLaserStore.getState>): boolean {
  return isActiveJob(laser.streamer) || laser.fireActive;
}

/**
 * Reports each change in whether a job runs, and answers main's session-end
 * events. Returns the uninstaller.
 */
export function installDesktopSessionEnd(
  target: Window,
  report: (busy: boolean) => Promise<void>,
): () => void {
  let busy = jobWouldBeCutOff(useLaserStore.getState());
  const send = (value: boolean): void => {
    report(value).catch((error: unknown) =>
      console.warn('Could not tell KerfDesk whether a job runs:', error),
    );
  };
  if (busy) send(true);
  const unsubscribe = useLaserStore.subscribe((laser) => {
    const next = jobWouldBeCutOff(laser);
    if (next === busy) return;
    busy = next;
    send(next);
  });
  const receive = (event: Event): void => {
    const phase = sessionEndPhase(event);
    if (phase === null) return;
    useSessionEndStore.setState({ phase });
    if (phase === 'ending') desktopCloseController.bestEffortStop();
  };
  target.addEventListener(SESSION_END_EVENT, receive);
  return () => {
    unsubscribe();
    target.removeEventListener(SESSION_END_EVENT, receive);
  };
}

function sessionEndPhase(event: Event): SessionEndPhase | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (typeof detail !== 'object' || detail === null || !('phase' in detail)) return null;
  return detail.phase === 'asked' || detail.phase === 'ending' ? detail.phase : null;
}
