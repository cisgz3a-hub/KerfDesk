import type { ControllerDriver } from '../../core/controllers';
import type { MachineKind } from '../../core/scene';
import {
  cncAccessoryStartIssue,
  cncOverrideFinalStartIssue,
  invalidateAccessoryObservation,
  type ReducedOverrideAcknowledgement,
} from './cnc-accessory-readiness';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (line: string) => Promise<void>;
type DriverFn = () => ControllerDriver;

const LIVE_STATUS_TIMEOUT_MS = 3_000;
const LIVE_STATUS_POLL_MS = 10;
const LIVE_STATUS_TIMEOUT_MESSAGE =
  'CNC Start could not obtain a fresh GRBL Ov:/A: live-state report. Check controller status reporting and try again.';
const MPG_ACTIVE_START_MESSAGE =
  'CNC Start is blocked while grblHAL reports MPG mode active. Return command control from the pendant/MPG to KerfDesk, wait for an MPG:0 report, then re-check setup.';
export function assertCncMpgInactive(set: SetFn, get: GetFn, machineKind: MachineKind): void {
  if (machineKind === 'cnc' && get().mpgActive === true) {
    rejectCncStart(set, get, MPG_ACTIVE_START_MESSAGE);
  }
}

export async function refreshCncLiveStartState(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
  driver: DriverFn,
  machineKind: MachineKind,
): Promise<void> {
  if (machineKind !== 'cnc') return;
  const statusQuery = driver().realtime.statusQuery;
  if (statusQuery === null) rejectCncStart(set, get, LIVE_STATUS_TIMEOUT_MESSAGE);

  // The caller has already drained an acknowledged queue fence. It is now
  // safe to discard ordinary pre-fence observations; exceptional grblHAL
  // latches survive until reset or an explicit A: report clears them.
  set((state) => ({
    ovCache: null,
    accessoryCache: invalidateAccessoryObservation(state.accessoryCache),
    controllerOperation: { kind: 'start-arming', phase: 'live-status' },
  }));
  const deadline = Date.now() + LIVE_STATUS_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    await safeWrite(statusQuery);
    // Capture only after the transport accepted the query. A buffered status
    // delivered before/during write cannot satisfy this response fence.
    const afterWrite = get().statusReport;
    const report = await waitForNextStatus(get, afterWrite, deadline);
    if (report === null) rejectCncStart(set, get, LIVE_STATUS_TIMEOUT_MESSAGE);
    // Return promptly so the final synchronous gate can name a disconnect,
    // alarm, non-Idle state, or exceptional grblHAL accessory condition.
    if (get().connection.kind !== 'connected' || report.state !== 'Idle') return;
    if (get().mpgActive === true) return;
    if (hasExceptionalAccessoryState(report.accessories)) return;
    if (report.ov != null && report.accessories != null) return;
  }
  rejectCncStart(set, get, LIVE_STATUS_TIMEOUT_MESSAGE);
}

export function assertCncLiveStartReady(
  set: SetFn,
  get: GetFn,
  machineKind: MachineKind,
  acknowledgedOverrides?: ReducedOverrideAcknowledgement,
): void {
  if (machineKind !== 'cnc') return;
  assertCncMpgInactive(set, get, machineKind);
  const state = get();
  if (state.connection.kind !== 'connected') {
    rejectCncStart(set, get, 'CNC Start requires an active controller connection.');
  }
  if (state.alarmCode !== null || state.statusReport?.state === 'Alarm') {
    rejectCncStart(set, get, 'CNC Start is blocked while the controller reports Alarm.');
  }
  if (state.statusReport === null) {
    rejectCncStart(set, get, 'CNC Start requires a fresh controller status report.');
  }
  if (state.statusReport.state !== 'Idle') {
    rejectCncStart(
      set,
      get,
      `CNC Start requires a fresh Idle report; the controller currently reports ${state.statusReport.state}.`,
    );
  }
  const overrideIssue = cncOverrideFinalStartIssue(
    machineKind,
    state.ovCache,
    acknowledgedOverrides,
  );
  if (overrideIssue !== null) rejectCncStart(set, get, overrideIssue);
  const accessoryIssue = cncAccessoryStartIssue(machineKind, state.accessoryCache);
  if (accessoryIssue !== null) rejectCncStart(set, get, accessoryIssue);
}

function hasExceptionalAccessoryState(accessories: LaserState['accessoryCache']): boolean {
  return (
    accessories?.secondarySpindlePresent === true ||
    accessories?.spindleEncoderFault === true ||
    accessories?.toolChangePending === true
  );
}

async function waitForNextStatus(
  get: GetFn,
  previous: LaserState['statusReport'],
  deadline: number,
): Promise<LaserState['statusReport']> {
  while (Date.now() <= deadline) {
    const current = get().statusReport;
    if (current !== null && current !== previous) return current;
    await sleep(LIVE_STATUS_POLL_MS);
  }
  return null;
}

function rejectCncStart(set: SetFn, get: GetFn, message: string): never {
  set({
    lastWriteError: message,
    log: pushLog(get(), `[lf2] CNC Start blocked: ${message}`),
  });
  throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
