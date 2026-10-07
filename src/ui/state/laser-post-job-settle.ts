import type { ControllerDriver } from '../../core/controllers';
import type { SerialConnection } from '../../platform/types';
import { startControllerCommand, waitForFreshIdle } from './laser-interactive-command';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import { controllerErrorNotice, type LaserSafetyAction } from './laser-safety-notice';
import { finishedJobStateReset, frameProofReset } from './laser-session-reset';
import { settledCompletedFramePatch } from './completed-frame-run';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';
import {
  continueControllerOperation,
  controllerOperationOwner,
} from './laser-controller-operation';
import {
  completeLiveCanvasRun,
  liveCanvasFinishingPatch,
  liveCanvasLifecyclePatch,
  liveCanvasTimingUnavailablePatch,
} from './live-canvas-run';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

const STABLE_IDLE_REPORTS = 2;
const SETTLE_MARKER_ACTIVITY_TIMEOUT_MS = 30_000;

/**
 * Controller lifecycle refs with the concrete active driver required to choose
 * the family-specific settlement marker.
 */
export type PostJobSettleRefs = ControllerLifecycleRefs & {
  readonly driver: ControllerDriver;
  readonly connection?: SerialConnection | null;
};

/**
 * Starts family-specific post-job drain confirmation and marks completion only
 * after that driver's settle marker and stable Idle evidence.
 */
export function beginPostJobSettle(
  set: SetFn,
  get: GetFn,
  refs: PostJobSettleRefs,
  safeWrite: SafeWriteFn,
): void {
  const state = get();
  if (state.connection.kind !== 'connected') return;
  if (state.streamer?.status !== 'done') return;
  if (state.controllerOperation !== null) return;
  if (refs.controllerCommand !== null || refs.controllerIdleWait !== null) return;
  const operation = { kind: 'post-job-settle', phase: 'dwell', idleReports: 0 } as const;
  const owner = controllerOperationOwner(operation);
  const connection = refs.connection;
  const driver = refs.driver;
  const writeEpoch = refs.writeEpoch ?? 0;
  const streamLines = state.streamer.queued;
  const ownsTransport = (): boolean =>
    refs.connection === connection &&
    refs.driver === driver &&
    (refs.writeEpoch ?? 0) === writeEpoch;
  const ownsCurrent = (current: LaserState = get()): boolean =>
    current.connection.kind === 'connected' &&
    current.controllerOperation !== null &&
    controllerOperationOwner(current.controllerOperation) === owner &&
    current.controllerSessionEpoch === state.controllerSessionEpoch &&
    current.streamerEpoch === state.streamerEpoch &&
    current.activeRunId === state.activeRunId &&
    current.streamer?.status === 'done' &&
    current.streamer.queued === streamLines &&
    ownsTransport();
  set({
    controllerOperation: operation,
    log: pushLog(state, '[lf2] Job lines acknowledged. Settling controller before ready.'),
  });
  void runPostJobSettle(set, refs, safeWrite, ownsCurrent, `${driver.commands.settleDwell}\n`);
}

async function runPostJobSettle(
  set: SetFn,
  refs: PostJobSettleRefs,
  safeWrite: SafeWriteFn,
  ownsCurrent: (state?: LaserState) => boolean,
  settleMarker: string,
): Promise<void> {
  try {
    if (!ownsCurrent()) return;
    // Use the active driver's settle marker (ADR-095), not a hardcoded GRBL
    // dwell: on Marlin the marker is M400 (acks only when buffered motion has
    // drained); G4 P is milliseconds there and acks immediately, so the settle
    // would clear the streamer mid-motion (CTL-02). GRBL's is 'G4 P0.01', so
    // its bytes are unchanged. The home action does the same at its call site.
    await startControllerCommand(refs, safeWrite, {
      kind: 'post-job-settle',
      label: 'post-job settle marker',
      command: settleMarker,
      action: 'console',
      source: 'system',
      timeoutMs: SETTLE_MARKER_ACTIVITY_TIMEOUT_MS,
      timeoutMode: 'non-idle-status-activity',
    });
    if (!ownsCurrent()) return;
    set((state) =>
      ownsCurrent(state)
        ? {
            controllerOperation: continueControllerOperation(state.controllerOperation, {
              kind: 'post-job-settle',
              phase: 'awaiting-idle',
              idleReports: 0,
            }),
            ...liveCanvasFinishingPatch(state),
          }
        : {},
    );
    // A reset/reconnect can land after the marker ACK but before its Promise
    // resumes, or during the phase update. It must not recreate an old waiter
    // on the replacement controller's shared lifecycle refs.
    if (!ownsCurrent()) return;
    await waitForFreshIdle(refs, {
      kind: 'post-job-settle',
      requiredReports: STABLE_IDLE_REPORTS,
    });
    set((state) =>
      ownsCurrent(state)
        ? {
            controllerOperation: null,
            streamer: null,
            ...finishedJobStateReset(),
            liveCanvasRun: completeLiveCanvasRun(state.liveCanvasRun ?? null),
            ...settledCompletedFramePatch(state),
            log: pushLog(state, '[lf2] Controller settled after job.'),
          }
        : {},
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The failure is terminal for the operation — clear it rather than park it
    // in a blocking phase. Every command (including Disconnect) gates on
    // controllerOperation being null, so a sticky failure would wedge the
    // whole panel until a cable yank. The 'done' streamer stays; the line
    // handler releases it at the next Idle report.
    set((state) =>
      ownsCurrent(state)
        ? {
            controllerOperation: null,
            ...frameProofReset(),
            lastWriteError: message,
            safetyNotice: state.safetyNotice ?? controllerErrorNotice(null, 'command', message),
            log: pushLog(state, `[lf2] Post-job controller settle failed: ${message}`),
            ...liveCanvasLifecyclePatch(state, 'errored'),
            ...liveCanvasTimingUnavailablePatch(
              { ...state, ...liveCanvasLifecyclePatch(state, 'errored') },
              'controller completion settlement could not be confirmed',
            ),
          }
        : {},
    );
  }
}
