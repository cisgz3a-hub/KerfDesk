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
  if (automatic.plannerBacklogBlocks !== undefined) {
    return `Automatic restarts at line ${automatic.line}: the controller had about ${automatic.plannerBacklogBlocks} moves buffered when it stopped and discarded them, so the restart steps back over them. Some may have burned already and will burn again; inspect the work and choose a later line if they did.`;
  }
  if (automatic.replaysRejectedLine) {
    return `Automatic restarts at line ${automatic.line}, the line the controller rejected, so that burn is not skipped. Lines after it that the controller ran before it stopped may burn again; inspect the work and choose a later line if they did.`;
  }
  return `Automatic restarts at line ${automatic.line}, from acknowledged command progress, which can be ahead of the physical cut. Inspect the work and choose an earlier movement if needed.`;
}
