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
// controller idles at `Bf:15,128`; a maintainer's Falcon A1 Pro (profiled as
// grblHAL, firmware build unconfirmed) reported `Bf:512,65535`.

import type { StatusReport } from '../../core/controllers/grbl';
import { hasUnsettledStreamAcks, isActiveJob } from './laser-store-helpers';
import type { LaserState } from './laser-store';

export type RxCapacityEvidence = {
  /** Largest free RX byte count reported while the host had nothing in flight. */
  readonly rxBytesFree: number;
  /** Planner blocks free in that same report; not a proof of planner capacity. */
  readonly plannerBlocksFree: number;
  readonly sessionEpoch: number;
  readonly observedAt: number;
};

export type PlannerCapacityEvidence = {
  /** Blocks free at a controller Idle report with no unsettled host ACKs. */
  readonly plannerBlocksFree: number;
  readonly sessionEpoch: number;
  readonly observedAt: number;
};

type EvidenceSource = Pick<
  LaserState,
  | 'streamer'
  | 'pendingUntrackedAcks'
  | 'controllerSessionEpoch'
  | 'rxCapacityEvidence'
  | 'plannerCapacityEvidence'
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

// Acknowledged motion can still occupy planner blocks while RX is empty.
// Only Idle proves those blocks have drained. Refresh independently of RX's
// high-water mark, since the first quiescent RX report may arrive during Jog.
function plannerCapacityEvidencePatch(
  state: EvidenceSource,
  report: StatusReport,
  now: number,
): Partial<Pick<LaserState, 'plannerCapacityEvidence'>> {
  const buffer = report.buffer;
  if (buffer == null || report.state !== 'Idle' || !hostHasNothingInFlight(state)) return {};
  return {
    plannerCapacityEvidence: {
      plannerBlocksFree: buffer.plannerBlocksFree,
      sessionEpoch: state.controllerSessionEpoch,
      observedAt: now,
    },
  };
}

function currentPlannerCapacityEvidence(
  state: Pick<LaserState, 'controllerSessionEpoch' | 'plannerCapacityEvidence'>,
): PlannerCapacityEvidence | null {
  const evidence = state.plannerCapacityEvidence ?? null;
  return evidence !== null && evidence.sessionEpoch === state.controllerSessionEpoch
    ? evidence
    : null;
}

export type StreamPlannerSnapshot = {
  readonly streamerEpoch: number;
  /** Session that owned the stream when this report arrived. */
  readonly sessionEpoch: number;
  /** Lines acknowledged when the report arrived. */
  readonly ackedLines: number;
  /** Planner blocks still waiting to move: idle size less `Bf` blocks free. */
  readonly queuedBlocks: number;
};

type PlannerSnapshotSource = EvidenceSource &
  Pick<LaserState, 'streamerEpoch' | 'streamPlannerSnapshot'>;

/** Independently qualify RX and planner capacities, then record the active
 *  run's planner backlog behind its acknowledgements. */
export function statusBufferPatch(
  state: PlannerSnapshotSource,
  report: StatusReport,
  now: number,
): Partial<
  Pick<LaserState, 'rxCapacityEvidence' | 'plannerCapacityEvidence' | 'streamPlannerSnapshot'>
> {
  const plannerPatch = plannerCapacityEvidencePatch(state, report, now);
  return {
    ...rxCapacityEvidencePatch(state, report, now),
    ...plannerPatch,
    ...streamPlannerSnapshotPatch({ ...state, ...plannerPatch }, report),
  };
}

// The planner size comes from this session's idle `Bf`. Without it the
// backlog is unknown and no snapshot is taken (controller audit recovery-6).
function streamPlannerSnapshotPatch(
  state: PlannerSnapshotSource,
  report: StatusReport,
): Partial<Pick<LaserState, 'streamPlannerSnapshot'>> {
  const buffer = report.buffer;
  const streamer = state.streamer;
  if (buffer === null || buffer === undefined || !isActiveJob(streamer) || streamer === null) {
    return {};
  }
  // A reboot can leave the interrupted stream mounted for recovery. Fresh
  // Idle capacity belongs to the replacement controller session, and must not
  // erase the last backlog of the run whose planner the reboot discarded.
  const previous = state.streamPlannerSnapshot;
  if (
    previous?.streamerEpoch === state.streamerEpoch &&
    previous.sessionEpoch !== state.controllerSessionEpoch
  ) {
    return {};
  }
  const capacity = currentPlannerCapacityEvidence(state)?.plannerBlocksFree;
  if (capacity === undefined) return {};
  return {
    streamPlannerSnapshot: {
      streamerEpoch: state.streamerEpoch,
      sessionEpoch: state.controllerSessionEpoch,
      ackedLines: streamer.completed,
      queuedBlocks: Math.max(0, capacity - buffer.plannerBlocksFree),
    },
  };
}
