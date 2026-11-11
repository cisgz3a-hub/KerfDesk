// The part's turn after an Abort on a dedicated A or Z rotary (ADR-695
// Amendment 1, rolling audit v13 Y5-P1-1). Every job and Frame on A or Z opens
// with `G92 A0` at the part's current turn. Restoring only the XY origin let a
// re-run zero again wherever the Abort left the part, so it burned a whole
// stopped turn (84 mm round an Ø60 glass) away from the half-burned piece.
// The stop now records the turn the job started from, Restore turns the part
// back to it with an ordinary jog, and Job Review says how far it has turned
// when no Restore is on offer.

import { currentJobStopRequest, type RotaryStartTurn } from '../state/job-stop-request';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { useStore } from '../state/store';
import { waitForControllerStatus } from './frame-status-wait';
import { clampJogFeed } from './jog-control-policy';

const TURN_BACK_FEED = 1500;
// Time for the jog to start and for the Idle report after it, on top of the turn.
const TURN_BACK_SETTLE_MS = 5_000;
// Below this the part is already where the job started (degrees on A, mm on Z).
const SAME_TURN = 0.01;

type TurnState = Pick<
  LaserState,
  'statusReport' | 'wcoCache' | 'controllerSettings' | 'machineZeroEpoch'
>;

/** After an operator Abort of an A or Z rotary job: its axis and how far the
 *  part has turned since that job started (null: not readable). */
export type RotaryTurnSinceAbort = {
  readonly axis: 'A' | 'Z';
  readonly since: number | null;
  /** The controller restarted since: the saved turn names nothing now. */
  readonly restarted?: true;
};

/** The turn since an aborted A or Z rotary job started, for Job Review. */
export function rotaryTurnSinceAbort(
  state: TurnState & Pick<LaserState, 'jobStopRequest' | 'streamerEpoch'>,
): RotaryTurnSinceAbort | null {
  const turn = currentJobStopRequest(state)?.rotaryStartTurn;
  if (turn === undefined) return null;
  if (rotaryStartTurnStale(state, turn)) return { axis: turn.axis, since: null, restarted: true };
  return { axis: turn.axis, since: rotaryTurnSinceStart(state, turn) };
}

/** ADR-695 Amendment 2 (rolling audit v14 Z2-P1-1): a power-up or port reopen
 *  since the Abort cleared machine position, so the saved turn is not a place
 *  on the part any more. Nothing may turn the part to it. */
export function rotaryStartTurnStale(
  state: Pick<LaserState, 'machineZeroEpoch'>,
  turn: RotaryStartTurn,
): boolean {
  return turn.machineZeroEpoch !== (state.machineZeroEpoch ?? 0);
}

/** The rotary axis's machine position now, or null while it is not reported. */
export function currentMachineTurn(state: TurnState, axis: 'A' | 'Z'): number | null {
  const report = state.statusReport;
  if (report === null) return null;
  const wco = report.wco ?? state.wcoCache;
  if (axis === 'A') return machineA(report, wco);
  const z = machineZ(report, wco);
  return z === null ? null : z * (state.controllerSettings?.reportInches === true ? 25.4 : 1);
}

type Report = NonNullable<LaserState['statusReport']>;

function machineA(report: Report, wco: LaserState['wcoCache']): number | null {
  if (report.mPos?.a !== undefined) return report.mPos.a;
  const work = report.wPos?.a;
  return work === undefined || wco?.a === undefined ? null : work + wco.a;
}

function machineZ(report: Report, wco: LaserState['wcoCache']): number | null {
  if (report.mPos !== null) return report.mPos.z;
  return report.wPos === null || wco === null ? null : report.wPos.z + wco.z;
}

/** How far the part has turned since the job started, or null when unknown. */
export function rotaryTurnSinceStart(state: TurnState, turn: RotaryStartTurn): number | null {
  const now = currentMachineTurn(state, turn.axis);
  return now === null ? null : now - turn.machine;
}

/** "160.4°" on A, "12.3 mm of Z" on Z, with its sign. */
export function formatRotaryTurn(axis: 'A' | 'Z', value: number): string {
  const sign = value < 0 ? '−' : '+';
  const size = Math.abs(value).toFixed(1);
  return axis === 'A' ? `${sign}${size}°` : `${sign}${size} mm of Z`;
}

/** Turn the part back to the turn the stopped job started from, laser off. */
export async function turnRotaryBackToJobStart(turn: RotaryStartTurn): Promise<void> {
  if (rotaryStartTurnStale(useLaserStore.getState(), turn)) {
    throw new Error(
      'The controller has restarted since the job you stopped, so the part was not turned. ' +
        'Turn it back to where that job started by hand.',
    );
  }
  const delta = rotaryTurnSinceStart(useLaserStore.getState(), turn);
  if (delta === null) {
    throw new Error(
      `KerfDesk cannot read where the rotary's ${turn.axis} axis is, so the part was not ` +
        'turned back. Turn it to where the stopped job started before you run again.',
    );
  }
  if (Math.abs(delta) < SAME_TURN) return;
  const feed = clampJogFeed(TURN_BACK_FEED, useStore.getState().project.device.maxFeed);
  const back = -delta;
  await useLaserStore.getState().jog(turn.axis === 'A' ? { da: back, feed } : { dz: back, feed });
  // The turn takes |back| / feed minutes (rolling audit v14 Z2-P2-1: a fixed
  // 3 s gave up on a correct turn of more than about 75 degrees).
  const turnMs = (Math.abs(back) / feed) * 60_000;
  const settled = await waitForControllerStatus(
    (state) =>
      state.statusReport?.state === 'Idle' &&
      state.motionOperation === null &&
      state.controllerOperation === null,
    turnMs * 1.5 + TURN_BACK_SETTLE_MS,
  );
  if (!settled) throw new Error('The rotary did not finish turning back. Check the part.');
}

/** The turn the stopped job started from, for Start from line to re-enter at
 *  (ADR-695 Amendment 1); undefined when no Abort recorded one. */
export function abortRotaryZero(): RotaryStartTurn | undefined {
  const state = useLaserStore.getState();
  const turn = currentJobStopRequest(state)?.rotaryStartTurn;
  // After a restart Start from line is refused rather than re-enter a stale turn.
  return turn === undefined || rotaryStartTurnStale(state, turn) ? undefined : turn;
}
