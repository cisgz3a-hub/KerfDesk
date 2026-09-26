// laser-stream-pause-beam — the beam around a stream-side Pause (controller
// audit MA-1). A controller without a realtime hold (Marlin) keeps running
// the moves it already accepted after Pause stops sending, and a laser left
// on stays on over the stopped head. The driver's plan
// (core/controllers/marlin/stream-pause-beam.ts) says which beam-off to queue
// behind that motion and how Resume switches the beam back on in the job's
// own commands. Every line owes an acknowledgement:
//  - Pause writes the beam-off lines as ordinary queued lines.
//  - Resume first requires those acknowledgements: the untracked ledger can
//    only attribute an acknowledgement owed before the stream's own lines if
//    nothing else is owed when the stream refills. It then restates the held
//    power on the next burn move and sends each restore line as an owned
//    command, awaited before the refill.

import type { ControllerDriver } from '../../core/controllers';
import type { StreamPauseBeamPlan } from '../../core/controllers/controller-driver';
import { startControllerCommand } from './laser-interactive-command';
import { writeWhilePauseResumeOwner } from './laser-pause-resume-confirmation';
import {
  PAUSE_RESUME_TRANSITION_TIMEOUT_MS,
  type PauseResumeTransitionToken,
} from './laser-pause-resume-transition';
import type { PostJobSettleRefs } from './laser-post-job-settle';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';

type StreamPauseBeamContext = {
  readonly set: (
    partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
  ) => void;
  readonly get: () => LaserState;
  readonly refs: PostJobSettleRefs;
  readonly safeWrite: (
    line: string,
    action?: LaserSafetyAction,
    source?: TranscriptSource,
  ) => Promise<void>;
};

export const STREAM_PAUSE_RESUME_WAIT_MESSAGE =
  'Resume waits until the controller has finished the moves it accepted before Pause: the ' +
  'beam-off KerfDesk queued behind them is not acknowledged yet. Resume once the machine has ' +
  'stopped, or use ABORT JOB.';

/** The system notice for a stream-side Pause. */
export function streamSidePauseMessage(offLines: ReadonlyArray<string>): string {
  const beamOff =
    offLines.length === 0
      ? 'The laser was off at this point of the job.'
      : `KerfDesk queued ${offLines.join(' and ')} behind them to switch the laser off once they finish.`;
  return (
    'This controller has no realtime pause, so Pause stops sending: the controller finishes the ' +
    `moves it has already accepted. ${beamOff} Resume once the machine has stopped; it switches ` +
    "the laser back on in the job's own commands. Request ABORT to stop at once, or use the " +
    'physical E-stop if unsafe.'
  );
}

/** The driver's plan for the paused stream, or null when it has none. */
export function streamPausePlan(
  state: LaserState,
  driver: ControllerDriver,
): StreamPauseBeamPlan | null {
  const streamer = state.streamer;
  if (streamer === null || driver.planStreamPauseBeam === undefined) return null;
  return driver.planStreamPauseBeam(streamer.queued, streamer.queueIndex);
}

/** Pause: queue the beam-off lines behind the buffered motion. */
export async function queueStreamPauseBeamOff(
  context: StreamPauseBeamContext,
  plan: StreamPauseBeamPlan | null,
): Promise<void> {
  for (const line of plan?.offLines ?? []) await context.safeWrite(`${line}\n`, 'pause');
}

/** Before Resume on a driver with a stream-side Pause plan. */
export function assertStreamPauseResumeReady(
  context: StreamPauseBeamContext,
  driver: ControllerDriver,
): void {
  if (driver.planStreamPauseBeam === undefined) return;
  if (context.get().pendingUntrackedAcks > 0) throw new Error(STREAM_PAUSE_RESUME_WAIT_MESSAGE);
}

/** Resume: bring the beam back before the stream refills. */
export async function restoreStreamPauseBeam(
  context: StreamPauseBeamContext,
  driver: ControllerDriver,
  token: PauseResumeTransitionToken,
): Promise<void> {
  const plan = streamPausePlan(context.get(), driver);
  if (plan === null) return;
  applyRestatedLine(context, plan);
  // Each restore line owes its own `ok` (source 'system'), and the stream
  // refills only once it has arrived.
  const ownedContext = {
    ...context,
    safeWrite: (line: string, action?: LaserSafetyAction) =>
      context.safeWrite(line, action, 'system'),
  };
  for (const line of plan.restoreLines) {
    await startControllerCommand(
      context.refs,
      (command) => writeWhilePauseResumeOwner(ownedContext, { token, command, action: 'resume' }),
      {
        kind: 'interactive-command',
        label: 'Resume beam restore',
        command: `${line}\n`,
        timeoutMs: PAUSE_RESUME_TRANSITION_TIMEOUT_MS,
      },
    );
  }
}

// The held power goes on the next burn move of the queue, in place, so the
// stream's line count (and the recovery checkpoint built on it) is unchanged.
function applyRestatedLine(context: StreamPauseBeamContext, plan: StreamPauseBeamPlan): void {
  const restated = plan.restatedLine;
  if (restated === null) return;
  context.set((state) => {
    const streamer = state.streamer;
    if (streamer?.status !== 'paused') return {};
    const index = streamer.queueIndex + restated.offset;
    if (index >= streamer.queued.length || restated.line.length > streamer.rxBufferBytes) {
      return {};
    }
    const queued = [...streamer.queued];
    queued[index] = restated.line;
    return { streamer: { ...streamer, queued } };
  });
}
