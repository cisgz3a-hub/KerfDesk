// What the Live Motion bar tells a screen reader (UX audit U7-P2-1).
//
// The bar itself is not a live region: its line count republishes up to every
// 120 ms, and as a polite region it queued about five announcements a second
// for the whole burn, burying every toast behind stale numbers. Instead one
// polite region speaks only changes of state (running, paused, resumed, a hold,
// aborted, finished) and the job's progress at each 10 %, and an assertive one
// speaks an alarm. Both stay mounted between jobs, so the end of a job is
// heard after the bar itself has gone, and both stay reachable behind a modal.

import { useEffect, useRef, useState } from 'react';
import type { StreamerStatus } from '../../core/controllers/grbl';
import { MODAL_REACHABLE_ATTRIBUTE } from '../common/hide-outside-modal';
import type { LiveCanvasLifecycle } from '../state/canvas-motion-plan';
import { useLaserStore } from '../state/laser-store';
import { streamProgressPercent, type LiveStreamProgress } from './use-live-stream-progress';

/** The part of the bar's description an announcement is built from. */
export type LiveMotionShown = {
  readonly heading: string;
  /** Spoken with the heading, such as what releases a hold. */
  readonly spokenDetail: string | null;
  readonly job: boolean;
};

export type LiveMotionAnnounced = {
  readonly heading: string | null;
  readonly job: boolean;
  readonly lastJobStatus: StreamerStatus | null;
  readonly decile: number;
};

export const NOTHING_ANNOUNCED: LiveMotionAnnounced = {
  heading: null,
  job: false,
  lastJobStatus: null,
  decile: 0,
};

const PROGRESS_STEP_PERCENT = 10;

/** Read from the bar's description: a job's heading speaks only its hold reason. */
export function shownForAnnouncer(
  description: {
    readonly heading: string;
    readonly detail: string;
    readonly abortLabel: string;
    readonly heldDetail?: string;
  } | null,
): LiveMotionShown | null {
  if (description === null) return null;
  const job = description.abortLabel === 'ABORT JOB';
  return {
    heading: description.heading,
    spokenDetail: job ? (description.heldDetail ?? null) : description.detail,
    job,
  };
}

/** The next announcement, if any, for the bar's current state. */
export function nextLiveMotionAnnouncement(
  previous: LiveMotionAnnounced,
  shown: LiveMotionShown | null,
  progress: LiveStreamProgress,
  /** How the store's run record says the job ended, when it has. */
  runLifecycle: LiveCanvasLifecycle | null,
): { readonly announced: LiveMotionAnnounced; readonly text: string | null } {
  const job = shown?.job === true;
  const decile = job ? progressDecile(progress) : 0;
  const continuing = job && previous.job;
  const announced: LiveMotionAnnounced = {
    heading: shown?.heading ?? null,
    job,
    lastJobStatus: job ? progress.status : previous.lastJobStatus,
    decile: continuing ? Math.max(previous.decile, decile) : decile,
  };
  const ending =
    previous.job && !job ? jobEnding(previous.lastJobStatus, progress.status, runLifecycle) : null;
  const change = stateChange(previous, shown, progress, continuing && decile > previous.decile);
  const parts = [ending, change].filter((part): part is string => part !== null);
  return { announced, text: parts.length === 0 ? null : parts.join('. ') };
}

function stateChange(
  previous: LiveMotionAnnounced,
  shown: LiveMotionShown | null,
  progress: LiveStreamProgress,
  nextStep: boolean,
): string | null {
  if (shown === null) return null;
  if (shown.heading !== previous.heading) return headingSentence(shown, previous.heading);
  // Progress is spoken only while the job runs, never over a hold's reason.
  if (!nextStep || shown.heading !== 'JOB RUNNING') return null;
  const percent = progressDecile(progress) * PROGRESS_STEP_PERCENT;
  return `${percent}% done, ${progress.completed} of ${progress.total} lines`;
}

function progressDecile(progress: LiveStreamProgress): number {
  if (progress.total <= 0) return 0;
  return Math.floor(streamProgressPercent(progress) / PROGRESS_STEP_PERCENT);
}

function headingSentence(shown: LiveMotionShown, previousHeading: string | null): string {
  const resumed =
    shown.heading === 'JOB RUNNING' &&
    (previousHeading === 'JOB RESUMING' || previousHeading === 'JOB PAUSED');
  const heading = resumed ? 'Job resumed' : sentenceCase(shown.heading);
  return shown.spokenDetail === null ? heading : `${heading}. ${shown.spokenDetail}`;
}

const RUN_ENDINGS: Partial<Record<LiveCanvasLifecycle, string>> = {
  finished: 'Job finished',
  stopped: 'Job aborted',
  disconnected: 'Job stopped: the controller disconnected',
  errored: 'Job stopped: the controller reported an error',
};

// A finished stream can go from streaming to released between two renders,
// so the run record, settled in the same Idle update, names the ending.
function jobEnding(
  lastJobStatus: StreamerStatus | null,
  status: StreamerStatus | null,
  runLifecycle: LiveCanvasLifecycle | null,
): string {
  if (status === 'cancelled') return 'Job aborted';
  if (status === 'disconnected') return RUN_ENDINGS.disconnected ?? '';
  const recorded = runLifecycle === null ? undefined : RUN_ENDINGS[runLifecycle];
  if (recorded !== undefined) return recorded;
  return lastJobStatus === 'done' ? 'Job finished' : 'Job ended';
}

function sentenceCase(heading: string): string {
  const lower = heading.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

type Spoken = { readonly text: string; readonly serial: number };

export function LiveMotionAnnouncer(props: {
  readonly shown: LiveMotionShown | null;
  readonly progress: LiveStreamProgress;
}): JSX.Element {
  const polite = usePoliteAnnouncement(props.shown, props.progress);
  const assertive = useAlarmAnnouncement(props.shown !== null);
  return (
    <div {...{ [MODAL_REACHABLE_ATTRIBUTE]: '' }} style={visuallyHiddenStyle}>
      <div aria-live="polite" data-testid="live-motion-announcement">
        {polite === null ? null : <span key={polite.serial}>{polite.text}</span>}
      </div>
      <div aria-live="assertive" data-testid="live-motion-alarm">
        {assertive === null ? null : <span key={assertive.serial}>{assertive.text}</span>}
      </div>
    </div>
  );
}

function usePoliteAnnouncement(
  shown: LiveMotionShown | null,
  progress: LiveStreamProgress,
): Spoken | null {
  const announced = useRef(NOTHING_ANNOUNCED);
  const [spoken, setSpoken] = useState<Spoken | null>(null);
  const runLifecycle = useLaserStore((state) => state.liveCanvasRun?.lifecycle ?? null);
  // By value: the bar builds a fresh description on every render.
  const heading = shown?.heading ?? null;
  const spokenDetail = shown?.spokenDetail ?? null;
  const job = shown?.job === true;
  useEffect(() => {
    const current = heading === null ? null : { heading, spokenDetail, job };
    const next = nextLiveMotionAnnouncement(announced.current, current, progress, runLifecycle);
    announced.current = next.announced;
    const text = next.text;
    if (text === null) return;
    // A fresh node each time, so a repeated sentence is spoken again.
    setSpoken((previous) => ({ text, serial: (previous?.serial ?? 0) + 1 }));
  }, [heading, spokenDetail, job, progress, runLifecycle]);
  return spoken;
}

// An alarm while the bar shows motion or a job stops that motion: say so at
// once. The Laser window's alarm banner says what it was and how to recover.
function useAlarmAnnouncement(barShown: boolean): Spoken | null {
  const alarm = useLaserStore((state) => state.statusReport?.state === 'Alarm');
  const barWasShown = useRef(false);
  const [spoken, setSpoken] = useState<Spoken | null>(null);
  useEffect(() => {
    if (alarm && barWasShown.current) {
      setSpoken((previous) => ({
        text: 'Alarm: the controller stopped the machine',
        serial: (previous?.serial ?? 0) + 1,
      }));
    }
  }, [alarm]);
  useEffect(() => {
    if (barShown) barWasShown.current = true;
    else if (!alarm) barWasShown.current = false;
  }, [barShown, alarm]);
  return spoken;
}

const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
