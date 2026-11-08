// Restore saved origin — put back the work origin an interrupted laser job ran
// with (ADR-341 Amendment 5).
//
// A controller reset or power cut clears a G92 origin (stock GRBL and FluidNC;
// on Windows opening the port can itself reset an Arduino-class board), so after
// a lost connection the recovery of a User Origin job had nowhere to land, and
// its refusal told the operator to Set origin here, wherever the head had
// stopped. The run's archive keeps the work offset it ran with. One G92 at the
// live machine position puts that offset back without moving the head:
// `G92 X(m - s)` makes the current point's work X equal m - s, so the offset
// becomes m - (m - s) = s whatever G54 holds.
//
// The offset lands where the job's origin was only while the machine measures
// position as it did when the job ran: after a reset, a machine that was homed
// before the job must be homed again first. The recovery review says so; this
// action refuses only what it factually cannot do (no machine position).
//
// A machine that was not homed cannot get its origin back from the numbers.
// Continue from where the head stopped (Amendment 6) writes the same kind of
// G92 from the other end: the head has not moved since the link dropped, so
// its current point is made the program point it stopped at.

import { formatGcodeCoordinateMm } from '../../core/gcode/coordinate-format';
import { inferCurrentMachinePosition, reportedWorkOffsetMm } from './infer-machine-position';
import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import type { StatusReport } from '../../core/controllers/grbl';
import { assertOriginActionReady, usesPrimaryWcs } from './laser-origin-readiness';
import { runOriginTransaction, type OriginSafeWrite } from './laser-origin-transaction';
import { beginOwnedReportUnitsLine } from './owned-report-units';
import { pushLog } from './laser-store-helpers';
import { withheldControllerMPos } from './laser-status-position';
import type { LaserState, LiveRefs } from './laser-store';
import type { WorkCoordinateOffset } from './origin-actions';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

export type SavedXyOffsetMm = { readonly x: number; readonly y: number };

export const RESTORE_ORIGIN_POSITION_UNKNOWN_MESSAGE =
  'KerfDesk does not know where the head is in machine coordinates yet, so it cannot put the ' +
  'saved origin back. Wait for a position report and try again.';

/** Restore saved origin waits this long for a report that gives the machine
 *  position: stock GRBL with $10=0 sends WCO: on one Idle report in ten, and
 *  the wait asks for a report every 250 ms, so one comes within 2.5 s (V3-P2-2). */
export const RESTORE_AIM_REPORT_WAIT_MS = 5_000;
const RESTORE_AIM_QUERY_MS = 250;

export const RESTORE_ORIGIN_WORK_POSITION_ONLY_MESSAGE =
  'The saved origin was not written. The controller reports only the work position ($10=0), ' +
  'and none of its reports in the last 5 s carried the work offset (WCO) that gives the ' +
  'machine position. Try Restore saved origin again in a moment, or use Set origin here.';

export const RESTORE_ORIGIN_NO_POSITION_REPORT_MESSAGE =
  'The saved origin was not written. No position report in the last 5 s gave the head’s ' +
  'machine position. Check that the controller is connected and answering, then try ' +
  'Restore saved origin again, or use Set origin here.';

export const RESTORE_ORIGIN_UNCONFIRMED_NOTICE =
  '[lf2] Saved origin written, but the controller has not confirmed the saved work offset. ' +
  'The recovery review keeps its last reported offset, which may still differ. ' +
  'Wait for a new position report and check the origin before you start.';

/** GRBL reports offsets to three decimals; the G92 is written to three. */
const RESTORED_OFFSET_TOLERANCE_MM = 0.005;
const RESTORE_WCO_WAIT_TIMEOUT_MS = 3_000;
const RESTORE_WCO_POLL_MS = 50;

/** The G92 that makes the work offset `saved` at machine position `machine`. */
export function savedOriginRestoreLine(
  machineMm: SavedXyOffsetMm,
  savedMm: SavedXyOffsetMm,
  grblFamily: boolean,
): string {
  const x = formatGcodeCoordinateMm(machineMm.x - savedMm.x);
  const y = formatGcodeCoordinateMm(machineMm.y - savedMm.y);
  // GRBL-family: select G54 like every origin action, and pin millimetres so a
  // startup block that chose G20 cannot scale the offset. Other dialects
  // (Marlin reads one G command per line) get G21 acknowledged separately.
  return grblFamily ? `G54 G21 G92 X${x} Y${y}` : `G92 X${x} Y${y}`;
}

export async function restoreWorkOrigin(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: OriginSafeWrite,
  savedMm: SavedXyOffsetMm,
): Promise<void> {
  await writeXyOffset(set, get, refs, safeWrite, RESTORE_ORIGIN_WRITE, () => savedMm);
}

export async function setOriginAtMachinePoint(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: OriginSafeWrite,
  pointMm: SavedXyOffsetMm,
  assertTargetCurrent?: () => void,
): Promise<void> {
  await writeXyOffset(
    set,
    get,
    refs,
    safeWrite,
    BOARD_ORIGIN_WRITE,
    () => pointMm,
    assertTargetCurrent,
  );
}

/**
 * Continue from where the head stopped (ADR-341 Amendment 6): after a lost
 * link, if the controller received and finished every sent line, the head is
 * at that predicted endpoint. Transport counts alone do not prove this. One
 * G92 makes that point the program point `pointMm`
 * without moving the head, so the rest of the job continues from it. Resolves
 * to the XY work offset written, in mm from machine zero.
 */
export async function setOriginAtProgramPoint(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: OriginSafeWrite,
  pointMm: SavedXyOffsetMm,
): Promise<SavedXyOffsetMm> {
  const outcome = await writeXyOffset(
    set,
    get,
    refs,
    safeWrite,
    HEAD_STOP_ORIGIN_WRITE,
    (machineMm) => ({
      x: machineMm.x - pointMm.x,
      y: machineMm.y - pointMm.y,
    }),
  );
  // Choosing the later restart line requires the anchor this action promises.
  // Preserve actual controller evidence on timeout, but do not call it success.
  if (!outcome.confirmed) throw new Error(HEAD_STOP_ORIGIN_WRITE.unconfirmedNotice);
  return outcome.offsetMm;
}

type XyOffsetWrite = {
  readonly label: string;
  readonly unconfirmedNotice: string;
  /** May aim from the MPos KerfDesk withholds after Unlock (ADR-341 Amendment 11). */
  readonly readsWithheldPosition?: true;
};

// After Unlock KerfDesk withholds the reported position until Home or an
// origin write (laser-status-position.ts), so the Alarm 3 card's restore had no
// MPos to aim from. `G92 X(m - s)` needs only the controller's own count m,
// which `$X` leaves as it was (ADR-375): the offset becomes s in the frame
// the controller measures in, as Set origin here's G92 X0 Y0 does, and the
// written origin then re-establishes position evidence like Set origin here.
const RESTORE_ORIGIN_WRITE: XyOffsetWrite = {
  label: 'Restore saved origin',
  unconfirmedNotice: RESTORE_ORIGIN_UNCONFIRMED_NOTICE,
  readsWithheldPosition: true,
};

const HEAD_STOP_ORIGIN_WRITE: XyOffsetWrite = {
  label: 'Continue from where the head stopped',
  unconfirmedNotice:
    '[lf2] Origin set from where the head stopped, but the controller has not confirmed the ' +
    'new work offset. The recovery review keeps its last reported offset, which may still ' +
    'differ. Wait for a new position report and frame the remaining area before you start.',
};

export const BOARD_ORIGIN_WRITE: XyOffsetWrite = {
  label: 'Set board origin',
  unconfirmedNotice:
    '[lf2] Board origin set, but the controller has not confirmed the new work offset. ' +
    'Its machine location is unconfirmed — jog once to refresh it before Start.',
};

/** One G92 at the live machine position that makes the XY work offset
 * `targetFor(machine)`, confirmed from the controller's own report. */
async function writeXyOffset(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: OriginSafeWrite,
  action: XyOffsetWrite,
  targetFor: (machineMm: SavedXyOffsetMm) => SavedXyOffsetMm,
  assertTargetCurrent?: () => void,
): Promise<{ readonly offsetMm: SavedXyOffsetMm; readonly confirmed: boolean }> {
  assertTargetCurrent?.();
  await assertOriginActionReady(set, get, refs, safeWrite);
  assertTargetCurrent?.();
  let machineMm = aimPoint(get(), action);
  if (machineMm === null && action.readsWithheldPosition === true) {
    machineMm = await waitForAimPoint(get, refs, safeWrite, action);
    // The wait let reports in: check again that nothing else started.
    await assertOriginActionReady(set, get, refs, safeWrite);
  }
  if (machineMm === null) throw new Error(RESTORE_ORIGIN_POSITION_UNKNOWN_MESSAGE);
  const before = get();
  const savedMm = targetFor(machineMm);
  const grblFamily = usesPrimaryWcs(before);
  const usesReportedOffset = before.capabilities.workOffsetSource !== 'host-recorded';
  const line = savedOriginRestoreLine(machineMm, savedMm, grblFamily);
  const sessionEpoch = before.controllerSessionEpoch;
  const writeEpoch = refs.writeEpoch;
  const confirmation = restoredOffsetConfirmation(get, refs, savedMm);
  let confirmed = true;
  try {
    await runOriginTransaction(
      set,
      get,
      refs,
      safeWrite,
      action.label,
      async (write) => {
        assertTargetCurrent?.();
        if (!grblFamily) {
          // Smoothieware's reports follow this G21 (owned-report-units.ts).
          const acknowledged = beginOwnedReportUnitsLine(
            set,
            get,
            refs.driver,
            'G21',
            action.label,
          );
          await write('G21\n');
          acknowledged();
        }
        assertTargetCurrent?.();
        if (usesReportedOffset) confirmation.observe();
        await write(`${line}\n`);
      },
      async (assertCurrent) => {
        // GRBL reports WCO; Smoothie reports MPos/WPos, from which the status
        // handler derives it. Marlin instead records the shift it writes itself.
        if (usesReportedOffset) confirmed = await confirmation.wait(assertCurrent);
        return restoredOriginPatch(get(), savedMm, usesReportedOffset);
      },
      {
        changesXyOrigin: true,
        reestablishesPositionEvidence: true,
        ...(assertTargetCurrent === undefined ? {} : { assertBeforeWrite: assertTargetCurrent }),
      },
    );
  } finally {
    confirmation.cancel();
  }
  if (
    !confirmed &&
    get().controllerSessionEpoch === sessionEpoch &&
    refs.writeEpoch === writeEpoch
  ) {
    set((state) => ({ log: pushLog(state, action.unconfirmedNotice) }));
  }
  return { offsetMm: savedMm, confirmed };
}

function restoredOffsetConfirmation(
  get: GetFn,
  refs: LiveRefs,
  savedMm: SavedXyOffsetMm,
): {
  readonly observe: () => void;
  readonly wait: (assertCurrent: () => void) => Promise<boolean>;
  readonly cancel: () => void;
} {
  let freshOffsetObserved = false;
  let ownedWait: LiveRefs['controllerStatusWait'] = null;
  return {
    observe: () => {
      const beforeWrite = get();
      const alreadyWaiting = refs.controllerStatusWait != null;
      // Register before G92: WCO can arrive before its ACK, then be omitted
      // from the next status frame. A position-only frame cannot freshen WCO.
      const observation = waitForFreshControllerStatus(refs, {
        after: {
          sessionEpoch: beforeWrite.controllerSessionEpoch,
          sequence: beforeWrite.statusSequence,
        },
        accept: (report) => report.wco !== null || (report.mPos !== null && report.wPos !== null),
        // The command owns its ACK timeout; wait() starts our 3 s after ACK.
        timeoutMs: null,
        timeoutMessage: RESTORE_ORIGIN_UNCONFIRMED_NOTICE,
      });
      ownedWait = alreadyWaiting ? null : refs.controllerStatusWait;
      void observation.then(
        () => {
          freshOffsetObserved = true;
        },
        () => undefined,
      );
    },
    wait: async (assertCurrent) => {
      const deadline = Date.now() + RESTORE_WCO_WAIT_TIMEOUT_MS;
      assertCurrent();
      while (!freshOffsetObserved || !offsetMatches(get(), savedMm)) {
        if (Date.now() > deadline) return false;
        await sleep(RESTORE_WCO_POLL_MS);
        assertCurrent();
      }
      return true;
    },
    cancel: () => {
      if (ownedWait != null && refs.controllerStatusWait === ownedWait) {
        cancelFreshControllerStatusWait(refs);
      }
    },
  };
}

// The controller's machine position: the live report's (MPos, or WPos plus a
// known WCO), else for Restore saved origin the MPos withheld after Unlock.
function aimPoint(state: LaserState, action: XyOffsetWrite): SavedXyOffsetMm | null {
  const reportInches = state.controllerSettings?.reportInches === true;
  return (
    inferCurrentMachinePosition(state.statusReport, state.wcoCache, reportInches) ??
    (action.readsWithheldPosition === true ? withheldMachineMm(state, reportInches) : null)
  );
}

// A $10=0 report gives the machine position only with WCO:, which stock GRBL
// sends on one Idle report in ten, and the Idle poll asks once a second, so
// after Unlock or Home the restore found none and failed (V3-P2-2). Ask for
// reports at the busy rate for a bounded time instead; a timeout, a new
// session, or Alarm or Sleep ends the wait with a message that says which.
async function waitForAimPoint(
  get: GetFn,
  refs: LiveRefs,
  safeWrite: OriginSafeWrite,
  action: XyOffsetWrite,
): Promise<SavedXyOffsetMm> {
  if (refs.controllerStatusWait != null) throw new Error(RESTORE_ORIGIN_POSITION_UNKNOWN_MESSAGE);
  const start = get();
  let workPositionOnly = false;
  const reportsWorkOnly = (report: StatusReport): void => {
    if (report.mPos === null && report.wPos !== null) workPositionOnly = true;
  };
  const query = refs.driver.realtime.statusQuery;
  const asking =
    query === null
      ? null
      : setInterval(() => {
          // A refused query only leaves the wait to the regular poll.
          void safeWrite(query, 'origin', 'motion').catch(() => undefined);
        }, RESTORE_AIM_QUERY_MS);
  try {
    await waitForFreshControllerStatus(refs, {
      after: { sessionEpoch: start.controllerSessionEpoch, sequence: start.statusSequence },
      onFreshReport: reportsWorkOnly,
      // The status handler stores the report before consumers see it.
      accept: () => aimPoint(get(), action) !== null,
      timeoutMs: RESTORE_AIM_REPORT_WAIT_MS,
      timeoutMessage: RESTORE_ORIGIN_NO_POSITION_REPORT_MESSAGE,
    });
  } catch (error: unknown) {
    if (workPositionOnly) throw new Error(RESTORE_ORIGIN_WORK_POSITION_ONLY_MESSAGE);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      reason === RESTORE_ORIGIN_NO_POSITION_REPORT_MESSAGE
        ? reason
        : `The saved origin was not written: ${reason}`,
    );
  } finally {
    if (asking !== null) clearInterval(asking);
  }
  const machineMm = aimPoint(get(), action);
  if (machineMm === null) throw new Error(RESTORE_ORIGIN_NO_POSITION_REPORT_MESSAGE);
  return machineMm;
}

function withheldMachineMm(state: LaserState, reportInches: boolean): SavedXyOffsetMm | null {
  const withheld = withheldControllerMPos(state.statusReport);
  if (withheld === null) return null;
  const scale = reportInches ? 25.4 : 1;
  return { x: withheld.x * scale, y: withheld.y * scale };
}

function offsetMatches(state: LaserState, savedMm: SavedXyOffsetMm): boolean {
  const live = reportedWorkOffsetMm(
    state.wcoCache,
    state.controllerSettings?.reportInches === true,
  );
  return (
    live !== null &&
    Math.abs(live.x - savedMm.x) <= RESTORED_OFFSET_TOLERANCE_MM &&
    Math.abs(live.y - savedMm.y) <= RESTORED_OFFSET_TOLERANCE_MM
  );
}

function restoredOriginPatch(
  state: LaserState,
  savedMm: SavedXyOffsetMm,
  usesReportedOffset: boolean,
): Partial<LaserState> {
  return {
    workOriginActive: true,
    workOriginSource: 'g92',
    positionEvidenceSuppressed: false,
    // A missing or contradictory controller report must not become a matching
    // report merely because this was the offset requested. Host-recorded
    // dialects instead retain the shift their acknowledged G92 wrote.
    wcoCache: usesReportedOffset ? state.wcoCache : writtenOffset(state, savedMm),
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
  };
}

// The offset the G92 wrote, in the controller's report units. Z is kept only
// when it was known before, as Set origin here does (axis-honest).
function writtenOffset(state: LaserState, savedMm: SavedXyOffsetMm): WorkCoordinateOffset | null {
  const prior = state.wcoCache;
  if (prior === null) return null;
  const scale = state.controllerSettings?.reportInches === true ? 1 / 25.4 : 1;
  return { x: savedMm.x * scale, y: savedMm.y * scale, z: prior.z };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
