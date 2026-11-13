// Sends one galvo program and watches it to its end (ADR-704). A run that
// fails part-way is stopped with MeerK40t's abort at once: the board may
// already be marking what it received. A run counts as finished after the
// board reported not-busy and its list not running on two status polls in a
// row; only then does a Frame count as completed for Start's frame-first gate.

import type { LmcLink } from '../../../core/controllers/jcz/lmc-link';
import {
  abortLmcProgram,
  finishLmcProgram,
  runLmcProgram,
} from '../../../core/controllers/jcz/lmc-run';
import { GALVO_STATUS_SILENT, galvoRunFailureText, galvoStopOutcome } from './galvo-usb-messages';
import type { GalvoGet, GalvoSet, GalvoUsbJob } from './galvo-usb-store';
import type { GalvoUsbSession } from './galvo-usb-types';

/** The open connection and the run in flight on it. */
export type GalvoLive = {
  readonly session: GalvoUsbSession;
  readonly link: LmcLink;
  /** Abort or a lost link: send no further list, stop watching. */
  cancel: boolean;
  /** The run in flight, which Abort waits for before it reports. */
  done: Promise<unknown>;
  /** Execute List was acknowledged for the run in flight. */
  executing: boolean;
  fiber: boolean;
};

export type GalvoRunContext = {
  readonly set: GalvoSet;
  readonly get: GalvoGet;
  readonly current: GalvoLive;
  readonly isLive: () => boolean;
};

export const galvoTiming = {
  pollMs: 200,
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

export async function runGalvoProgram(
  ctx: GalvoRunContext,
  kind: 'frame' | 'job',
  job: GalvoUsbJob,
): Promise<void> {
  const { set, current } = ctx;
  const frame = kind === 'frame';
  const lists = frame ? job.frame.lists : job.program.lists;
  current.cancel = false;
  current.executing = false;
  current.fiber = !frame && (job.program.source === 'fiber' || job.program.source === 'mopa');
  set({
    phase: frame ? 'framing' : 'running',
    advisories: frame ? [] : job.advisories,
    sending: { sent: 0, total: lists.length },
    message: frame ? 'Sending the red-light Frame (laser off)…' : 'Sending the job…',
    tone: 'info',
  });
  const result = await runLmcProgram(current.link, lists, kind, current.fiber, {
    cancelled: () => current.cancel,
    paused: () => ctx.get().phase === 'paused',
    onProgress: (sent, total) => set({ sending: { sent, total } }),
    sleep: galvoTiming.sleep,
  });
  current.executing = result.executing;
  set({ sending: null });
  // Abort owns a cancelled run; a lost link has nothing left to send.
  if (!ctx.isLive() || current.cancel) return;
  if (!result.ok) {
    const stopped = await abortLmcProgram(current.link, result.executing);
    if (!ctx.isLive()) return;
    current.executing = false;
    set({
      phase: 'idle',
      advisories: [],
      message: `Sending stopped after ${result.sent} list(s): ${galvoRunFailureText(result, current.link.lastFailure)} ${galvoStopOutcome(stopped)}`,
      tone: 'error',
    });
    return;
  }
  set({
    message: frame
      ? 'Frame sent; the red pointer is tracing the job outline.'
      : 'Job sent; the board is marking it.',
  });
  await watchToEnd(ctx, kind, job);
}

async function watchToEnd(
  ctx: GalvoRunContext,
  kind: 'frame' | 'job',
  job: GalvoUsbJob,
): Promise<void> {
  const stillOurs = (): boolean => ctx.isLive() && !ctx.current.cancel;
  let idleReads = 0;
  while (stillOurs()) {
    await galvoTiming.sleep(galvoTiming.pollMs);
    if (!stillOurs()) return;
    const idle = await pollIdle(ctx);
    if (!stillOurs()) return;
    idleReads = idle ? idleReads + 1 : 0;
    if (idleReads >= 2) {
      await finished(ctx, kind, job);
      return;
    }
  }
}

/** One status poll: true when the board is idle and not held by a Pause. */
async function pollIdle(ctx: GalvoRunContext): Promise<boolean> {
  const listState = await ctx.current.link.listState();
  const status = await ctx.current.link.boardStatus();
  if (listState === null || status === null) {
    ctx.set({ message: GALVO_STATUS_SILENT, tone: 'warning' });
    return false;
  }
  ctx.set({ listState });
  return !status.busy && listState !== 'running' && ctx.get().phase !== 'paused';
}

async function finished(
  ctx: GalvoRunContext,
  kind: 'frame' | 'job',
  job: GalvoUsbJob,
): Promise<void> {
  const { set, current } = ctx;
  current.executing = false;
  const closed = await finishLmcProgram(current.link, current.fiber);
  if (!ctx.isLive() || current.cancel) return;
  const after = closed ? '' : ' The board did not acknowledge switching its outputs off.';
  set(
    kind === 'frame'
      ? {
          phase: 'idle',
          framed: job.program.footprint,
          message: `Frame finished. Start is available for this footprint.${after}`,
          tone: closed ? 'info' : 'warning',
        }
      : {
          phase: 'idle',
          advisories: [],
          message: `Job finished: the board reports idle.${after}`,
          tone: closed ? 'info' : 'warning',
        },
  );
  // "After completed job" variable advance, only for a job the board finished
  // (an aborted or failed run never gets here; ADR-705 Amendment 7).
  if (kind === 'job') job.completed();
}
