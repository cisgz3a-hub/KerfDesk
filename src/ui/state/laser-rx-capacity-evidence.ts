// laser-rx-capacity-evidence — latches the controller's own report of how much
// serial receive buffer it has, from the status `Bf:<blocks>,<bytes>` field.
//
// The second value is FREE bytes, not capacity. It equals capacity exactly when
// the host has nothing outstanding in the controller's RX ring: no job line in
// flight and no queued command still owed its terminal ack. The largest such
// reading in the current controller session is the one live proof of receive
// capacity a grblHAL controller offers — its extended `$I` is not stock proof
// and the Falcon vendor contract forbids `$I` anyway — and the Start boundary
// bounds the character-counting window by it (ADR-331). A stock GRBL 1.1
// controller idles at `Bf:15,128`; the maintainer's Falcon A1 Pro (grblHAL) at
// `Bf:512,65535`.

import type { StatusReport } from '../../core/controllers/grbl';
import { hasUnsettledStreamAcks } from './laser-store-helpers';
import type { LaserState } from './laser-store';

export type RxCapacityEvidence = {
  /** Largest free RX byte count reported while the host had nothing in flight. */
  readonly rxBytesFree: number;
  /** Planner blocks free in that same report — the planner's size when idle. */
  readonly plannerBlocksFree: number;
  readonly sessionEpoch: number;
  readonly observedAt: number;
};

type EvidenceSource = Pick<
  LaserState,
  'streamer' | 'pendingUntrackedAcks' | 'controllerSessionEpoch' | 'rxCapacityEvidence'
>;

/** True when no job line and no owed-ack command can still occupy the RX ring. */
export function hostHasNothingInFlight(
  state: Pick<LaserState, 'streamer' | 'pendingUntrackedAcks'>,
): boolean {
  return !hasUnsettledStreamAcks(state.streamer) && state.pendingUntrackedAcks === 0;
}

/**
 * Patch applied per status report: keeps the largest quiescent `Bf:` RX free
 * count of the current session. Reports that arrive while lines are in flight
 * carry occupancy, not capacity, and are ignored.
 */
export function rxCapacityEvidencePatch(
  state: EvidenceSource,
  report: StatusReport,
  now: number,
): Partial<Pick<LaserState, 'rxCapacityEvidence'>> {
  const buffer = report.buffer;
  if (buffer === null || buffer === undefined) return {};
  if (!hostHasNothingInFlight(state)) return {};
  const current = currentRxCapacityEvidence(state);
  if (current !== null && current.rxBytesFree >= buffer.rxBytesFree) return {};
  return {
    rxCapacityEvidence: {
      rxBytesFree: buffer.rxBytesFree,
      plannerBlocksFree: buffer.plannerBlocksFree,
      sessionEpoch: state.controllerSessionEpoch,
      observedAt: now,
    },
  };
}

/** Evidence from the current controller session only; a reset or reconnect
 * may boot different firmware with a different ring. */
export function currentRxCapacityEvidence(
  state: Pick<LaserState, 'controllerSessionEpoch' | 'rxCapacityEvidence'>,
): RxCapacityEvidence | null {
  const evidence = state.rxCapacityEvidence ?? null;
  return evidence !== null && evidence.sessionEpoch === state.controllerSessionEpoch
    ? evidence
    : null;
}
