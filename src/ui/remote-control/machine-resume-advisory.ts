// The PC's CNC Resume advisory for phones and MCP (rolling audit v11 W2-P2-1,
// ADR-585 Amendment 2). The PC shows `cncResumeAdvisoryNotice` in the paused
// job panel and on the Resume button: on FluidNC by default, and with laser
// mode on or unconfirmed, Resume feeds a stopped or still-accelerating bit
// along the cut. A remote operator is not looking at that screen, so the
// status carries the same text whenever the PC shows it. Where the PC says to
// prefer ABORT JOB, a remote Resume must also name the warning it was shown
// (its confirmation code) or is refused with it.

import {
  cncJobLaserModeEnabled,
  cncPauseControllerKind,
  cncPauseLiftPhase,
  cncPauseLiftSkipReason,
} from '../state/cnc-pause-lift-state';
import { cncResumeAdvisoryNotice } from '../state/cnc-pause-resume-policy';
import type { useLaserStore } from '../state/laser-store';
import { RemoteFault } from './fault';
import { safeLabel } from './projections';

type Laser = ReturnType<typeof useLaserStore.getState>;

/** Remote message bound (the MCP `message` schema). */
export const REMOTE_POLICY_MESSAGE_MAX = 2048;
const ADVISORY_MAX = 1800;
const ADVISORY_FALLBACK =
  'Resume has a warning for this CNC job. Read it on the PC before resuming, or abort the job.';

export type RemoteResumeAdvisory = {
  /** The PC's advisory, word for word. */
  readonly message: string;
  /** Present where the PC prefers ABORT JOB: names this warning for this job, and a
   *  remote Resume must echo it to proceed. */
  readonly confirmation?: string;
};

/** What the PC shows beside a paused CNC job's Resume, or null (laser, not paused). */
export function remoteResumeAdvisory(laser: Laser): RemoteResumeAdvisory | null {
  if (laser.streamer?.status !== 'paused') return null;
  // The same selectors JobRunControls and LiveMotionBar read.
  const laserMode = cncJobLaserModeEnabled(laser);
  const liftPhase = cncPauseLiftPhase(laser);
  const controllerKind = cncPauseControllerKind(laser);
  const text = cncResumeAdvisoryNotice(
    laser.activeJobMachineKind,
    laserMode,
    liftPhase,
    cncPauseLiftSkipReason(laser),
    controllerKind,
  );
  if (text === null) return null;
  const message = safeLabel(text, ADVISORY_FALLBACK, ADVISORY_MAX);
  // A lift owns the bit, and stock GRBL at a confirmed $32=0 waits its spin-up delay:
  // there the PC only informs. FluidNC (no lift, spinup_ms 0 unless set) and a laser
  // mode that is on or unconfirmed are where it says to prefer ABORT JOB.
  const prefersAbort = liftPhase === null && (controllerKind === 'fluidnc' || laserMode !== false);
  if (!prefersAbort) return { message };
  return { message, confirmation: confirmationCode(`${laser.streamerEpoch}\n${message}`) };
}

/** A fixed desktop policy refusal; its text holds no artwork, so it skips the label filter. */
export class MachinePolicyRefusal extends RemoteFault {
  constructor(message: string) {
    super('unavailable');
    this.message = message.slice(0, REMOTE_POLICY_MESSAGE_MAX);
  }
}

/** Refuses a remote Resume whose confirmation does not name the current warning. */
export function assertResumeAdvisoryConfirmed(laser: Laser, confirmation: string | undefined) {
  const advisory = remoteResumeAdvisory(laser);
  if (advisory?.confirmation === undefined || confirmation === advisory.confirmation) return;
  const lead =
    confirmation === undefined
      ? 'Not resumed: this paused CNC job has a Resume warning to confirm first.'
      : 'Not resumed: the Resume warning changed since it was confirmed.';
  throw new MachinePolicyRefusal(
    `${lead} ${advisory.message} To resume anyway, confirm this warning; otherwise abort the job.`,
  );
}

/** The Pause receipt: on CNC, what Resume will do from here, as the PC shows it. */
export function remotePauseReceipt(laser: Laser): string {
  const advisory = remoteResumeAdvisory(laser);
  return advisory === null ? 'Paused.' : `Paused. ${advisory.message}`;
}

// FNV-1a, 32 bits: a short tag for a fixed string, not a secret.
function confirmationCode(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
