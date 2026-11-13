// Windows restarting, shutting down or signing out during a job (ADR-548).
// The window tells the main process whether a job runs, and how far a streamed
// job is for the taskbar button (ADR-553). Main asks Windows to wait and tells
// the window, which says so in a notice; when Windows ends the session anyway,
// the window tries to send the same Abort as closing KerfDesk. Windows can end
// KerfDesk before that Abort reaches the machine, so the notice never promises it
// (ADR-548 Amendment 1).
//
// A laser the controller reports on at Idle counts as a job here, as the
// ordinary close turns it off and the update close refuses for it (ADR-375
// Amendment 9): a file that ends without M5 or a Console `G1 … M3 S…` leaves
// the beam lit on one spot after KerfDesk is gone (rolling audit v11 W3-P2-1).

import { create } from 'zustand';
import type { StreamerState } from '../../core/controllers/grbl';
import type { DesktopJobReport } from '../../platform/types';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { activeLinkMachineWork, useLinkMachineWorkStore } from '../state/link-machine-work';
import { unownedControllerOutput } from '../state/unowned-controller-output';
import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { desktopCloseController } from './desktop-close-runtime';

type LaserState = ReturnType<typeof useLaserStore.getState>;

/** A running job's progress alone is reported at most this often (ADR-553). */
export const JOB_PROGRESS_REPORT_MS = 1000;

export type SessionEndPhase = 'asked' | 'ending';

export const SESSION_END_EVENT = 'kerfdesk:session-end';

export const SESSION_END_MESSAGES: Readonly<Record<SessionEndPhase, string>> = {
  asked:
    'Windows wants to restart, shut down or sign out while a job runs or the laser is on, and ' +
    'KerfDesk asked it to wait. Let the job finish or Abort it, or use LASER OFF, before you ' +
    'restart. If Windows restarts anyway, it can close KerfDesk before an Abort reaches the ' +
    'machine, and a spindle or constant-power laser can stay on until the controller is reset.',
  ending:
    'Windows is ending this session during the job or with the laser on. KerfDesk is sending Abort ' +
    'or LASER OFF, but Windows can close KerfDesk before it reaches the machine: use the physical ' +
    'E-stop or power cutoff if the machine may still be running.',
};

type SessionEndState = {
  readonly phase: SessionEndPhase | null;
  readonly dismiss: () => void;
};

export const useSessionEndStore = create<SessionEndState>((set) => ({
  phase: null,
  dismiss: () => set({ phase: null }),
}));

/** A job, a latched Fire, or a laser left on at Idle, that ending the session would cut off. */
export function jobWouldBeCutOff(laser: LaserState): boolean {
  return (
    isActiveJob(laser.streamer) ||
    activeLinkMachineWork() !== null ||
    laser.fireActive ||
    unownedControllerOutput(laser, machineKindOf(useStore.getState().project.machine)) !== null
  );
}

/** What main is told: whether a job runs and, for a streamed job, how far it is. */
export function desktopJobReport(laser: LaserState): DesktopJobReport {
  const busy = jobWouldBeCutOff(laser);
  const streamer = laser.streamer;
  if (!busy || streamer === null || !isActiveJob(streamer)) return { busy };
  const progress = streamer.total > 0 ? Math.min(1, streamer.completed / streamer.total) : 0;
  return { busy, job: { progress: Math.max(0, progress), state: jobState(streamer.status) } };
}

function jobState(status: StreamerState['status']): 'running' | 'paused' | 'error' {
  if (status === 'errored') return 'error';
  return status === 'paused' || status === 'tool-change' ? 'paused' : 'running';
}

/**
 * Reports each change in whether a job runs or is held, and its progress in
 * whole percent at most once a second, and answers main's session-end events.
 * Returns the uninstaller.
 */
export function installDesktopSessionEnd(
  target: Window,
  report: (report: DesktopJobReport) => Promise<void>,
): () => void {
  const reports = jobReports((next) => {
    report(next).catch((error: unknown) =>
      console.warn('Could not tell KerfDesk whether a job runs:', error),
    );
  });
  reports.consider(desktopJobReport(useLaserStore.getState()));
  const unsubscribeLaser = useLaserStore.subscribe((laser) =>
    reports.consider(desktopJobReport(laser)),
  );
  // A Moshi, K40 or Ruida link job counts too (ADR-705 Amendment 3).
  const unsubscribeLinks = useLinkMachineWorkStore.subscribe(() =>
    reports.consider(desktopJobReport(useLaserStore.getState())),
  );
  const unsubscribe = (): void => {
    unsubscribeLaser();
    unsubscribeLinks();
  };
  const receive = (event: Event): void => {
    const phase = sessionEndPhase(event);
    if (phase === null) return;
    useSessionEndStore.setState({ phase });
    if (phase === 'ending') desktopCloseController.bestEffortStop();
  };
  target.addEventListener(SESSION_END_EVENT, receive);
  return () => {
    unsubscribe();
    reports.dispose();
    target.removeEventListener(SESSION_END_EVENT, receive);
  };
}

// Main starts each page with no job, so only a change is sent. A change in
// whether a job runs or is held goes at once; progress alone waits its turn.
function jobReports(send: (report: DesktopJobReport) => void) {
  let sent: DesktopJobReport = { busy: false };
  let sentAt = Number.NEGATIVE_INFINITY;
  let latest = sent;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = (): void => {
    cancel();
    sent = latest;
    sentAt = Date.now();
    send(latest);
  };
  return {
    consider(next: DesktopJobReport): void {
      latest = next;
      if (reportKey(next) === reportKey(sent)) {
        cancel();
        return;
      }
      if (stateKey(next) !== stateKey(sent)) {
        flush();
        return;
      }
      if (timer !== null) return;
      const wait = sentAt + JOB_PROGRESS_REPORT_MS - Date.now();
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    dispose: cancel,
  };
}

function stateKey(report: DesktopJobReport): string {
  return `${report.busy}:${report.job?.state ?? 'none'}`;
}

function reportKey(report: DesktopJobReport): string {
  const percent = report.job === undefined ? '' : Math.floor(report.job.progress * 100);
  return `${stateKey(report)}:${percent}`;
}

function sessionEndPhase(event: Event): SessionEndPhase | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (typeof detail !== 'object' || detail === null || !('phase' in detail)) return null;
  return detail.phase === 'asked' || detail.phase === 'ending' ? detail.phase : null;
}
