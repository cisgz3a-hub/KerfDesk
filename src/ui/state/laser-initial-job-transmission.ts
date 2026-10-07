import type { JobActionContext } from './laser-job-actions';
import type { StartJobOptions } from './laser-store';
import type { laserStartOverrideReset } from './laser-start-override-reset';
import { assertMachineExecutionOwner, ownedMachineWrite } from './machine-execution-owner';
import { createJobStartWriteAttempt } from './laser-start-transmission-error';
import type { createStartArmingCompletion } from './laser-start-arming-completion';
import {
  type streamWriteOwner,
  containActiveStreamWriteFailure,
} from './laser-stream-heartbeat-containment';
import { liveCanvasExecutionAcceptedPatch } from './live-canvas-run';
import { armHostedRefill } from './laser-hosted-refill';

export async function transmitInitialWindow(
  context: JobActionContext,
  overrideReset: ReturnType<typeof laserStartOverrideReset>,
  firstWindow: string,
  completion: ReturnType<typeof createStartArmingCompletion>,
  writeOwner: ReturnType<typeof streamWriteOwner>,
  runId: string | null,
  options: StartJobOptions = {},
): Promise<void> {
  const { set, get, safeWrite } = context;
  const attempt = createJobStartWriteAttempt(runId);
  try {
    assertMachineExecutionOwner(options.executionOwner);
    await overrideReset.send(
      firstWindow,
      ownedMachineWrite(safeWrite, options.executionOwner),
      completion.ownsCurrent,
      () => {
        assertMachineExecutionOwner(options.executionOwner);
        attempt.markProgramAttempted();
        options.onStartCommitted?.(runId ?? '', writeOwner.streamerEpoch);
      },
    );
    attempt.assertProgramAttempted();
    if (!completion.ownsCurrent()) return;
    set((state) => overrideReset.accepted(state, liveCanvasExecutionAcceptedPatch(state)));
    // The first window is accounted for. A capable transport may now own
    // refill; an unsupported transport or superseded stream is a no-op.
    await armHostedRefill(context.refs, () => (completion.ownsCurrent() ? get().streamer : null));
    completion.accept();
  } catch (error) {
    const state = get();
    const ackedLines =
      state.streamerEpoch === writeOwner.streamerEpoch ? (state.streamer?.completed ?? 0) : 0;
    containActiveStreamWriteFailure(set, context.refs, safeWrite, 'start', writeOwner);
    // Keep actual program-prefix uncertainty independently of live state.
    // A rejected reset or cancelled reset continuation attempted no program.
    throw attempt.failure(error, ackedLines);
  }
}
