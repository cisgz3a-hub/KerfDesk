// Smoothieware Kernel::get_query_string formats both MPos and WPos with
// Robot::from_millimeters; Robot::push_state/pop_state also saves inch_mode.
// Frame must select G21 before capturing coordinates or issuing its M120.
// https://github.com/Smoothieware/Smoothieware/blob/edge/src/libs/Kernel.cpp
// https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/robot/Robot.cpp
import type { ControllerDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import type { ConsoleActionRefs } from './laser-console-actions';
import { consoleCommandBlockReason } from './console-command-readiness';
import { beginReportUnitsWrite } from './controller-report-units';
import {
  controllerOperationOwner,
  interactiveControllerOperation,
} from './laser-controller-operation';
import { waitForFreshControllerStatus } from './laser-controller-status-wait';
import { cancelControllerLifecycleRefs, startControllerCommand } from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import { hasPendingControllerWrite } from './laser-start-queue-fence';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';

type NormalizeArgs = {
  readonly set: (
    partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState>),
  ) => void;
  readonly get: () => LaserState;
  readonly refs: ConsoleActionRefs;
  readonly write: (
    line: string,
    action: LaserSafetyAction | undefined,
    source: TranscriptSource,
  ) => Promise<void>;
  readonly signal?: AbortSignal | undefined;
};

const STATUS_TIMEOUT_MS = 3_000;
const STATUS_MESSAGE =
  'Frame could not confirm a fresh millimetre position after selecting G21. Check the controller connection, then Frame again.';

/** No motion: one exclusively owned G21 acknowledgement, then one fresh mm
 * report. Preserve physical origin/Work-Z identity while dropping every old
 * raw report and WCO value, which may have been expressed in inches. */
export async function normalizeFrameReportUnits(args: NormalizeArgs): Promise<void> {
  const { get, set, refs, signal } = args;
  const context = normalizationContext(args);
  if (context === null) return;
  const { owns, assertOwned, cancel } = reserveNormalization(args, context);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    // The pre-command report proves Idle without interpreting its units. The
    // operation owns polling, so no other query or queued mutation crosses it.
    await freshReport(args, context.query, assertOwned);
    assertOwned();
    set(beginReportUnitsWrite());
    assertOwned();
    await startControllerCommand(
      refs,
      (line, action, source) => args.write(line, action, source ?? 'system'),
      {
        kind: 'interactive-command',
        label: 'Select millimetres for Frame',
        command: context.wire,
        action: 'frame',
        source: 'system',
      },
    );
    assertOwned();
    // Clear again after the ACK: even a report received during the G21 write
    // cannot become the post-normalization coordinate snapshot.
    set((state) => ({
      ...beginReportUnitsWrite(),
      reportUnitsUnconfirmed: false,
      controllerSettings: { ...state.controllerSettings, reportInches: false },
    }));
    const report = await freshReport(args, context.query, assertOwned);
    assertOwned();
    if (!completePosition(report) || !completePosition(get().statusReport))
      throw new Error(STATUS_MESSAGE);
  } catch (error) {
    // The same owner alone may cancel its remaining wait. Never cancel work
    // belonging to a reconnected controller or clear that session's operation.
    cancel();
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (owns()) set({ controllerOperation: null });
  }
}

type NormalizationContext = {
  readonly driver: ControllerDriver;
  readonly query: string;
  readonly wire: string;
  readonly before: LaserState;
};

function normalizationContext(args: NormalizeArgs): NormalizationContext | null {
  const { get, refs, signal } = args;
  signal?.throwIfAborted();
  const driver = refs.driver;
  const command = driver.commands.frameReportUnitsCommand;
  if (command === undefined) return null;
  const query = driver.realtime.statusQuery;
  if (query === null) throw new Error('This controller cannot confirm Frame report units.');
  const prepared = driver.prepareConsoleCommand(command);
  if (!prepared.ok) throw new Error(prepared.reason);
  const before = get();
  const blocked = consoleCommandBlockReason(before, prepared.command, false);
  if (blocked !== null) throw new Error(blocked);
  if (
    refs.controllerCommand !== null ||
    refs.controllerStatusWait != null ||
    hasPendingControllerWrite(before)
  ) {
    throw new Error(
      'Wait for the previous controller command and acknowledgement before preparing Frame report units.',
    );
  }
  return { driver, query, wire: prepared.command.wire, before };
}

function reserveNormalization(args: NormalizeArgs, context: NormalizationContext) {
  const { get, set, refs, signal } = args;
  const { driver, before } = context;
  const operation = interactiveControllerOperation(
    'Confirm millimetre coordinates for Frame',
    'terminal-exchange',
  );
  const writeEpoch = refs.writeEpoch;
  const owns = (): boolean => {
    const current = get();
    return (
      current.connection.kind === 'connected' &&
      current.controllerSessionEpoch === before.controllerSessionEpoch &&
      refs.driver === driver &&
      refs.writeEpoch === writeEpoch &&
      current.controllerOperation !== null &&
      controllerOperationOwner(current.controllerOperation) === operation
    );
  };
  const assertOwned = (): void => {
    signal?.throwIfAborted();
    if (
      !owns() ||
      get().trustedPositionEpoch !== before.trustedPositionEpoch ||
      get().workZReferenceEpoch !== before.workZReferenceEpoch
    ) {
      throw new Error(
        'Controller session or coordinates changed while preparing Frame report units.',
      );
    }
  };
  const cancel = (): void => {
    if (owns()) cancelControllerLifecycleRefs(refs, 'Frame report-unit preparation was cancelled.');
  };
  set({
    controllerOperation: operation,
    framedRun: null,
    frameTrace: null,
    frameVerification: null,
  });
  return { owns, assertOwned, cancel };
}

async function freshReport(
  args: NormalizeArgs,
  query: string,
  assertOwned: () => void,
): Promise<StatusReport> {
  assertOwned();
  const state = args.get();
  const confirmation = waitForFreshControllerStatus(args.refs, {
    after: { sessionEpoch: state.controllerSessionEpoch, sequence: state.statusSequence },
    accept: () => true,
    timeoutMs: STATUS_TIMEOUT_MS,
    timeoutMessage: STATUS_MESSAGE,
  });
  // Register before writing: a synchronous/fast serial adapter may deliver
  // the report before the transport promise resolves.
  const [, report] = await Promise.all([args.write(query, 'frame', 'system'), confirmation]);
  assertOwned();
  if (report.state !== 'Idle')
    throw new Error(
      `Frame report-unit preparation requires Idle; the controller reported ${report.state}.`,
    );
  return report;
}

function completePosition(report: StatusReport | null): boolean {
  return (
    report?.mPos != null &&
    report.wPos != null &&
    [
      report.mPos.x,
      report.mPos.y,
      report.mPos.z,
      report.wPos.x,
      report.wPos.y,
      report.wPos.z,
    ].every(Number.isFinite)
  );
}
