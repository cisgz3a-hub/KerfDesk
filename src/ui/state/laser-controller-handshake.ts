import { idleCollector } from '../../core/controllers/grbl';
import { beginSettingsCollection } from './detected-settings-action';
import {
  cancelControllerLifecycleRefs,
  startControllerCommand,
  waitForFreshIdle,
} from './laser-interactive-command';
import {
  failedControllerQualificationPatch,
  qualifiedController,
  qualifyingController,
} from './laser-controller-qualification';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState, LiveRefs } from './laser-store';
import { pushLog } from './laser-store-helpers';
import { appendSystemNotice } from './laser-system-notice';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

const PASSIVE_STARTUP_WAIT_MS = 250;
const ACTIVE_HANDSHAKE_WAIT_MS = 1_750;
const LATE_BANNER_SETTLE_MS = 300;

type HandshakeEpochGuard = {
  expectedWriteEpoch: number;
  expectedSessionEpoch: number;
  sawWelcomeBoundary: boolean;
  acceptControllerLineEpoch: () => boolean;
};

type ControllerResponse = 'line' | 'timeout' | 'stale';

export function controllerHandshakeOwnership(
  get: GetFn,
  refs: LiveRefs,
  connection: NonNullable<LiveRefs['connection']>,
) {
  let qualificationEpoch = get().controllerSessionEpoch;
  let writeEpoch = refs.writeEpoch ?? 0;
  return {
    get qualificationEpoch(): number {
      return qualificationEpoch;
    },
    adopt: (epoch: number): void => {
      qualificationEpoch = epoch;
      writeEpoch = refs.writeEpoch ?? 0;
    },
    isCurrent: (): boolean =>
      refs.connection === connection &&
      (refs.writeEpoch ?? 0) === writeEpoch &&
      get().controllerSessionEpoch === qualificationEpoch,
  };
}

export async function runControllerHandshake(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  baudRate: number,
  onQualificationEpoch: (epoch: number) => void,
): Promise<void> {
  const connection = refs.connection;
  if (connection === null) return;
  const guard = createHandshakeEpochGuard(get, refs, connection, onQualificationEpoch);
  const response = await awaitControllerResponse(refs, safeWrite, guard);
  if (response === 'stale') return;
  if (response === 'timeout') {
    reportMissingControllerResponse(set, get, refs, baudRate, guard.expectedSessionEpoch);
    return;
  }
  await settleAfterControllerLine(guard.sawWelcomeBoundary);
  if (!guard.acceptControllerLineEpoch()) return;
  await waitForHandshakeIdle(get, refs, safeWrite);
  if (!guard.acceptControllerLineEpoch()) return;
  await qualifyConnectedController(set, get, refs, safeWrite, connection, guard);
}

function createHandshakeEpochGuard(
  get: GetFn,
  refs: LiveRefs,
  connection: NonNullable<LiveRefs['connection']>,
  onQualificationEpoch: (epoch: number) => void,
): HandshakeEpochGuard {
  const guard: HandshakeEpochGuard = {
    expectedWriteEpoch: refs.writeEpoch ?? 0,
    expectedSessionEpoch: get().controllerSessionEpoch,
    sawWelcomeBoundary: false,
    acceptControllerLineEpoch: () => false,
  };
  guard.acceptControllerLineEpoch = (): boolean => {
    if (refs.connection !== connection) return false;
    const currentWriteEpoch = refs.writeEpoch ?? 0;
    if (currentWriteEpoch === guard.expectedWriteEpoch) return true;
    // The first welcome banner is the expected reset boundary for a new port.
    // Adopt only that one epoch; later reset boundaries invalidate the await.
    if (
      !guard.sawWelcomeBoundary &&
      currentWriteEpoch === guard.expectedWriteEpoch + 1 &&
      get().detectedControllerKind !== null
    ) {
      guard.expectedWriteEpoch = currentWriteEpoch;
      guard.expectedSessionEpoch = get().controllerSessionEpoch;
      guard.sawWelcomeBoundary = true;
      onQualificationEpoch(guard.expectedSessionEpoch);
      return true;
    }
    return false;
  };
  return guard;
}

async function awaitControllerResponse(
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  guard: HandshakeEpochGuard,
): Promise<ControllerResponse> {
  let gotLine = await waitForNextControllerLine(refs, PASSIVE_STARTUP_WAIT_MS);
  if (!guard.acceptControllerLineEpoch()) return 'stale';
  if (gotLine) return 'line';
  const nextLine = waitForNextControllerLine(refs, ACTIVE_HANDSHAKE_WAIT_MS);
  const realtimeQuery = refs.driver.realtime.statusQuery;
  if (realtimeQuery !== null) {
    await safeWrite(realtimeQuery);
    if (!guard.acceptControllerLineEpoch()) return 'stale';
  }
  gotLine = await nextLine;
  if (!guard.acceptControllerLineEpoch()) return 'stale';
  return gotLine ? 'line' : 'timeout';
}

function reportMissingControllerResponse(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  baudRate: number,
  expectedEpoch: number,
): void {
  const driver = refs.driver;
  set(
    appendSystemNotice(
      get(),
      refs,
      `[lf2] No controller response within 2 s. Check baud rate (${baudRate}) and that the device is ${driver.label}.`,
    ),
  );
  set((state) =>
    failedControllerQualificationPatch(
      state,
      expectedEpoch,
      `No controller response was received at ${baudRate} baud. Check the cable and controller profile, then retry.`,
    ),
  );
}

async function qualifyConnectedController(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  connection: NonNullable<LiveRefs['connection']>,
  guard: HandshakeEpochGuard,
): Promise<void> {
  const settingsQuery = refs.driver.commands.settingsQuery;
  const qualificationEpoch = guard.expectedSessionEpoch;
  if (settingsQuery === null) {
    set({
      controllerQualification: qualifiedController(qualificationEpoch, 'not-required'),
      log: pushLog(get(), '[lf2] Connected.'),
    });
    return;
  }
  set({
    controllerOperation: { kind: 'connection-handshake', phase: 'settings' },
    log: pushLog(get(), `[lf2] Connected. Querying settings (${settingsQuery})...`),
    detectedSettings: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    controllerQualification: qualifyingController(qualificationEpoch, 'settings-read'),
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  });
  beginSettingsCollection(refs, qualificationEpoch);
  await startControllerCommand(refs, safeWrite, {
    kind: 'connection-handshake',
    label: 'controller settings query',
    command: `${settingsQuery}\n`,
    source: 'system',
  });
  if (!handshakeIsCurrent(refs, connection, guard.expectedWriteEpoch)) return;
  if (!qualificationCompleted(get(), qualificationEpoch)) {
    refs.settingsCollector = idleCollector();
    refs.settingsCollectorSessionEpoch = null;
  }
  set((state) =>
    qualificationCompleted(state, qualificationEpoch)
      ? {}
      : failedControllerQualificationPatch(
          state,
          qualificationEpoch,
          'The controller settings response was empty. Retry reading controller settings.',
        ),
  );
}

function qualificationCompleted(state: LaserState, expectedEpoch: number): boolean {
  return (
    state.controllerQualification.kind === 'qualified' &&
    state.controllerQualification.epoch === expectedEpoch
  );
}

async function waitForHandshakeIdle(
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  const state = get();
  if (
    state.statusReport?.state === 'Idle' &&
    state.statusObservation?.sessionEpoch === state.controllerSessionEpoch
  ) {
    return;
  }
  const realtimeQuery = refs.driver.realtime.statusQuery;
  const queuedQuery = refs.driver.commands.queuedStatusQuery;
  if (realtimeQuery === null && queuedQuery === null) {
    throw new Error('This controller cannot provide a fresh Idle status for qualification.');
  }
  const idle = waitForFreshIdle(refs, { kind: 'connection-handshake' });
  try {
    if (realtimeQuery !== null) {
      await safeWrite(realtimeQuery, undefined, 'system');
      await idle;
      return;
    }
    await Promise.all([
      idle,
      startControllerCommand(refs, safeWrite, {
        kind: 'connection-handshake',
        label: 'initial controller status query',
        command: `${queuedQuery ?? ''}\n`,
        source: 'system',
      }),
    ]);
  } catch (error) {
    cancelControllerLifecycleRefs(refs, 'Initial controller qualification failed.');
    await idle.catch(() => undefined);
    throw error;
  }
}

function settleAfterControllerLine(sawWelcomeBoundary: boolean): Promise<void> {
  if (sawWelcomeBoundary) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, LATE_BANNER_SETTLE_MS));
}

function waitForNextControllerLine(refs: LiveRefs, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (gotLine: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(gotLine);
    };
    const onLineArrived = (): void => {
      clearTimeout(timer);
      if (refs.onLineArrived === onLineArrived) refs.onLineArrived = null;
      settle(true);
    };
    const timer = setTimeout(() => {
      if (refs.onLineArrived === onLineArrived) refs.onLineArrived = null;
      settle(false);
    }, timeoutMs);
    refs.onLineArrived = onLineArrived;
  });
}

function handshakeIsCurrent(
  refs: LiveRefs,
  connection: NonNullable<LiveRefs['connection']>,
  writeEpoch: number,
): boolean {
  return refs.connection === connection && (refs.writeEpoch ?? 0) === writeEpoch;
}
