// cnc-pause-reentry-run (ADR-411) — Resume after "Pause and lift". The bit is
// at safe height with the spindle off, and the controller holds none of the
// job. Resume re-checks the frame, spins the spindle up there with the
// program's own dwell, rapids above the stop point, feeds straight down into
// its own kerf, and only then replays the stream from the line the bit was
// on. A failure on the way ends the job with Abort's reset.

import { step } from '../../core/controllers/grbl';
import { rewindPausedStream } from '../../core/controllers/grbl/streamer';
import { cncReentrySteps, type CncReentryStep } from '../../core/recovery/cnc-pause-reentry';
import {
  failCncPauseLift,
  moveCncLift,
  sendCncLiftLine,
  type CncPauseLiftContext,
} from './cnc-pause-lift-commands';
import {
  currentCncPauseLift,
  ownsCncPauseLift,
  samePoint,
  scaled,
  type CncPauseLift,
} from './cnc-pause-lift-state';
import { armHostedRefill, releaseHostedRefill } from './laser-hosted-refill';
import { captureHostedRefillStream } from './laser-hosted-refill-owner';
import {
  containActiveStreamWriteFailure,
  streamWriteOwner,
} from './laser-stream-heartbeat-containment';
import type { LaserState } from './laser-store';
import { mpgCommandBlockMessage, pushLog } from './laser-store-helpers';
import { liveCanvasExecutionAcceptedPatch } from './live-canvas-run';
import { steppedStreamerPatch } from './tool-change-hold-entry';

/** Beyond its own dwell, how long the controller may take to answer G4. */
const DWELL_MARGIN_MS = 10_000;

export const CNC_REENTRY_BUSY_MESSAGE =
  'Pause and lift is still moving the bit. Wait for it to finish, or use ABORT JOB.';

export async function resumeLiftedCncJob(context: CncPauseLiftContext): Promise<void> {
  const lift = currentCncPauseLift(context.get());
  if (lift === null) return;
  const blocked = reentryBlockMessage(context.get(), lift);
  if (blocked !== null) {
    context.set((state) => ({
      lastWriteError: blocked,
      log: pushLog(state, `[lf2] Resume blocked: ${blocked}`),
    }));
    throw new Error(blocked);
  }
  // Pause took the refill back; confirm the worker holds none before the
  // stream is rewound under it.
  await releaseHostedRefill(context.refs);
  if (!ownsCncPauseLift(context.get(), lift.token)) return;
  context.set((state) => ({
    cncPauseLift: { ...lift, phase: 'entering' },
    log: pushLog(state, '[lf2] Pause and lift: spinning up above the cut before re-entering.'),
  }));
  try {
    for (const reentryStep of cncReentrySteps(lift.plan)) {
      await runReentryStep(context, lift, reentryStep);
    }
  } catch (error) {
    await failCncPauseLift(context, lift.token, error);
    throw error;
  }
  await restartStreamAtReentry(context, lift);
}

/** Why Resume cannot re-enter yet, or null. */
export function reentryBlockMessage(state: LaserState, lift: CncPauseLift): string | null {
  if (lift.phase !== 'lifted') return CNC_REENTRY_BUSY_MESSAGE;
  if (state.connection.kind !== 'connected') return 'The controller is not connected.';
  const mpg = mpgCommandBlockMessage(state);
  if (mpg !== null) return mpg;
  if (state.statusReport?.state !== 'Idle') {
    return 'The controller must report Idle before the bit returns to the cut.';
  }
  const wco = state.wcoCache;
  if (wco === null || !samePoint(scaled(wco, lift.reportInches), lift.workOffsetMm)) {
    return 'The work offset changed while the job was paused, so the bit cannot find its cut again. Use ABORT JOB and recover from the Interrupted job card.';
  }
  return null;
}

async function runReentryStep(
  context: CncPauseLiftContext,
  lift: CncPauseLift,
  reentryStep: CncReentryStep,
): Promise<void> {
  switch (reentryStep.kind) {
    case 'move':
      await moveCncLift(context, lift, reentryStep.line, reentryStep.target, 'resume');
      return;
    case 'dwell':
      // GRBL answers G4 only once the dwell has run out.
      await sendCncLiftLine(
        context,
        lift.token,
        reentryStep.line,
        'resume',
        reentryStep.seconds * 1000 + DWELL_MARGIN_MS,
      );
      return;
    case 'modal':
    case 'spindle':
    case 'coolant':
    case 'restore':
      await sendCncLiftLine(context, lift.token, reentryStep.line, 'resume');
  }
}

/**
 * The bit is back in its kerf at full speed. Rewind the paused stream to the
 * resume line and send it on as a normal resumed stream.
 */
async function restartStreamAtReentry(
  context: CncPauseLiftContext,
  lift: CncPauseLift,
): Promise<void> {
  const { set, get, refs, safeWrite } = context;
  if (!ownsCncPauseLift(get(), lift.token)) return;
  const writeOwner = streamWriteOwner(get());
  const readOwnedStreamer = captureHostedRefillStream(context);
  let toSend = '';
  set((state) => {
    if (state.streamer === null || !ownsCncPauseLift(state, lift.token)) return {};
    const rewound = rewindPausedStream(state.streamer, lift.plan.resumeLineIndex);
    const stepped = step(rewound);
    toSend = stepped.toSend;
    return {
      ...steppedStreamerPatch(state, rewound, stepped.state),
      cncPauseLift: null,
      // The lift proved the work frame unchanged, so the live view may follow
      // the reported head again.
      ...(state.liveCanvasRun == null
        ? {}
        : {
            liveCanvasRun: {
              ...state.liveCanvasRun,
              plan: { ...state.liveCanvasRun.plan, positionEpoch: state.trustedPositionEpoch ?? 0 },
            },
          }),
      log: pushLog(
        state,
        `[lf2] Pause and lift: back in the cut; the job continues from streamed line ${lift.plan.resumeLineIndex + 1}.`,
      ),
    };
  });
  if (toSend.length === 0) return;
  try {
    await safeWrite(toSend, 'resume');
    if (readOwnedStreamer() === null) return;
    set((state) => liveCanvasExecutionAcceptedPatch(state, true));
    await armHostedRefill(refs, readOwnedStreamer);
  } catch (error) {
    containActiveStreamWriteFailure(set, refs, safeWrite, 'resume', writeOwner);
    throw error;
  }
}
