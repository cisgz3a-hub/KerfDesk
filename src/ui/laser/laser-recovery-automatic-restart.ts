import {
  automaticRestart,
  type AutomaticRestart,
} from '../../core/recovery/automatic-restart-line';
import type { RecoveryCapsule } from '../state/recovery';

/** The line an automatic recovery of this saved run restarts from; null when
 * only a fingerprint was saved and the program text is not available. */
export function automaticRecoveryRestart(capsule: RecoveryCapsule): AutomaticRestart | null {
  const artifact = capsule.artifact;
  return artifact.kind === 'exact-execution'
    ? automaticRestart(artifact.gcode, capsule.ackedLines, capsule.interruption)
    : null;
}

/** What the automatic choice replays, in the operator's terms. */
export function automaticRestartHint(automatic: AutomaticRestart | null): string {
  if (automatic === null) {
    return 'Automatic uses acknowledged command progress, which can be ahead of the physical cut. Inspect the work and choose an earlier movement if needed.';
  }
  const ifRestarted = ifRestartedHint(automatic);
  const hint = automaticLineHint(automatic);
  return ifRestarted === null ? hint : `${hint} ${ifRestarted}`;
}

function automaticLineHint(automatic: AutomaticRestart): string {
  const backlogHint = plannerBacklogHint(automatic);
  if (backlogHint !== null) return backlogHint;
  if (automatic.replaysRejectedLine) {
    return `Automatic restarts at line ${automatic.line}, the line the controller rejected, so that burn is not skipped. Lines after it that the controller ran before it stopped may burn again; inspect the work and choose a later line if they did.`;
  }
  return `Automatic restarts at line ${automatic.line}, from acknowledged command progress, which can be ahead of the physical cut. Inspect the work and choose an earlier movement if needed.`;
}

/** The step back a restart would need, when the reconnect after a lost link
 * could not show whether the controller restarted (ADR-398 Amendment 4). */
function ifRestartedHint(automatic: AutomaticRestart): string | null {
  const step = automatic.ifRestarted;
  if (step === undefined) return null;
  const lost =
    step.basis === 'planner-size'
      ? `it may have thrown away up to ${step.blocks} buffered moves, a whole planner`
      : step.basis === 'after-empty-status'
        ? 'it threw away the moves acknowledged after its last report showed an empty buffer'
        : `it threw away about ${step.blocks} buffered moves`;
  return `The reconnect did not show whether the controller restarted. If it did, ${lost}: restart from line ${step.line} to replay them.`;
}

const REPLAY_ADVICE =
  'Some may have burned already and will burn again; inspect the work and choose a later line if they did.';

function plannerBacklogHint(automatic: AutomaticRestart): string | null {
  const blocks = automatic.plannerBacklogBlocks;
  if (blocks === undefined) return null;
  // Either no status report showed the backlog, or the app restarted while the
  // job ran (a promoted record), so the hint blames neither the controller nor
  // the app (rolling audit v5 J1-P3-4); the record's cause says which.
  if (automatic.plannerBacklogBasis === 'planner-size') {
    return `Automatic restarts at line ${automatic.line}: KerfDesk could not tell how many moves the controller still had buffered, and the stop may have discarded up to ${blocks}, a whole planner, so the restart steps back over that many. ${REPLAY_ADVICE}`;
  }
  if (automatic.plannerBacklogBasis === 'after-empty-status') {
    return `Automatic restarts at line ${automatic.line}: the controller's last status report showed an empty buffer, and the stop may have discarded the moves acknowledged after it, so the restart steps back to the first of them. ${REPLAY_ADVICE}`;
  }
  return `Automatic restarts at line ${automatic.line}: the controller had about ${blocks} moves buffered when it stopped and discarded them, so the restart steps back over them. ${REPLAY_ADVICE}`;
}
