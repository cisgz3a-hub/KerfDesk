import { type LaserControllerOperation } from './laser-controller-operation';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import { controllerErrorNotice, type LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { mpgCommandBlockMessage, pushLog } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

export type OriginSafeWrite = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

export type OriginCommandWriter = (write: (line: string) => Promise<void>) => Promise<void>;

export class OriginTransactionCancelledError extends Error {
  constructor() {
    super('Origin transaction was cancelled by a controller session change.');
    this.name = 'OriginTransactionCancelledError';
  }
}

export async function runOriginTransaction(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: OriginSafeWrite,
  label: string,
  writeCommands: OriginCommandWriter,
  successPatch: (assertCurrent: () => void) => Partial<LaserState> | Promise<Partial<LaserState>>,
  options: {
    readonly changesXyOrigin?: boolean;
    readonly reestablishesPositionEvidence?: boolean;
  } = {},
): Promise<void> {
  const operation: LaserControllerOperation = {
    kind: 'interactive-command',
    phase: 'command',
    label,
  };
  let pendingLine = '';
  const { ownsTransaction, assertCurrent } = originTransactionOwner(get, refs, operation);
  set({
    controllerOperation: operation,
    lastWriteError: null,
    ...(options.reestablishesPositionEvidence === true
      ? { positionEvidenceSuppressed: false }
      : {}),
  });
  try {
    await writeCommands(async (line) => {
      pendingLine = line;
      assertCurrent();
      await startControllerCommand(refs, safeWrite, {
        kind: 'interactive-command',
        label,
        command: line,
        action: 'origin',
        source: 'origin',
      });
      assertCurrent();
    });
    // successPatch may await a fresh controller frame — Set Origin waits for the
    // post-G92 work-offset report so it never records a location-unknown origin.
    assertCurrent();
    const patch = await successPatch(assertCurrent);
    assertCurrent();
    set((state) =>
      ownsTransaction(state)
        ? {
            ...patch,
            ...(options.changesXyOrigin === true
              ? { workOriginVersion: (state.workOriginVersion ?? 0) + 1 }
              : {}),
            controllerOperation:
              state.controllerOperation === operation ? null : state.controllerOperation,
            lastWriteError: null,
            log: pushLog(state, `[lf2] ${label} acknowledged by the controller.`),
          }
        : state,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    set((state) =>
      ownsTransaction(state)
        ? {
            ...unknownOriginPatch(),
            ...(options.changesXyOrigin === true
              ? { workOriginVersion: (state.workOriginVersion ?? 0) + 1 }
              : {}),
            ...originControllerFailurePatch(state, message, pendingLine),
            controllerOperation:
              state.controllerOperation === operation ? null : state.controllerOperation,
            lastWriteError: message,
            log: pushLog(
              state,
              `[lf2] ${label} failed while waiting on ${pendingLine.trim() || 'the controller'}. Work-origin state is unknown: ${message}`,
            ),
          }
        : state,
    );
    throw error instanceof Error ? error : new Error(message);
  }
}

function originTransactionOwner(
  get: GetFn,
  refs: ControllerLifecycleRefs,
  operation: LaserControllerOperation,
): {
  readonly ownsTransaction: (state: LaserState) => boolean;
  readonly assertCurrent: () => void;
} {
  const sessionEpoch = get().controllerSessionEpoch;
  const writeEpoch = refs.writeEpoch;
  const ownsTransaction = (state: LaserState): boolean =>
    state.connection.kind === 'connected' &&
    state.controllerSessionEpoch === sessionEpoch &&
    refs.writeEpoch === writeEpoch &&
    state.controllerOperation === operation;
  const assertCurrent = (): void => {
    if (!ownsTransaction(get())) throw new OriginTransactionCancelledError();
    assertOriginWireOwnership(get);
  };
  return { ownsTransaction, assertCurrent };
}

function assertOriginWireOwnership(get: GetFn): void {
  const mpgBlock = mpgCommandBlockMessage(get());
  if (mpgBlock !== null) throw new Error(mpgBlock);
}

export function unknownOriginPatch(): Partial<LaserState> {
  return {
    workOriginActive: true,
    workOriginSource: 'unknown',
    positionEvidenceSuppressed: true,
    statusReport: null,
    statusObservation: null,
    workZZeroEvidence: null,
    wcoCache: null,
    frameVerification: null,
    framedRun: null,
  };
}

function originControllerFailurePatch(
  state: LaserState,
  message: string,
  pendingLine: string,
): Partial<LaserState> {
  if (state.safetyNotice !== null) return {};
  const alarmMatch = /ALARM:(\d+)/i.exec(message);
  if (alarmMatch?.[1] !== undefined) {
    const code = Number.parseInt(alarmMatch[1], 10);
    return {
      alarmCode: code,
      safetyNotice: controllerErrorNotice(code, 'command', message, pendingLine),
    };
  }
  const errorMatch = /(?:^|\s)error(?::(\d+))?/i.exec(message);
  if (errorMatch === null) return {};
  const code = errorMatch[1] === undefined ? null : Number.parseInt(errorMatch[1], 10);
  return { safetyNotice: controllerErrorNotice(code, 'command', message, pendingLine) };
}
