import type { StatusReport } from '../../core/controllers/grbl';
import type { ControllerEvent } from '../../core/controllers';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type CommandWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

export type ControllerCommandKind =
  | 'autofocus'
  | 'connection-handshake'
  | 'home'
  | 'post-job-settle'
  | 'probe'
  | 'interactive-command'
  | 'recovery'
  | 'start-arming'
  | 'work-z-recovery';

export type ControllerLifecycleRefs = {
  controllerCommand: ControllerCommandRequest | null;
  controllerIdleWait: ControllerIdleWaitRequest | null;
  controllerResetWait?: ControllerResetWaitRequest | null;
  // Serial-session/reset generation. Late transport promises from an older
  // epoch must not mutate the current write/ack ledgers.
  writeEpoch?: number;
};

type ControllerResetWaitRequest = {
  readonly expectedEpoch: number;
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

type ControllerCommandRequest = {
  readonly kind: ControllerCommandKind;
  readonly label: string;
  readonly timeoutMs: number;
  readonly timeoutMode: ControllerCommandTimeoutMode;
  readonly completion: ControllerCommandCompletion;
  readonly responses: string[];
  readonly resolve: (responses: ReadonlyArray<string>) => void;
  readonly reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  acceptingResponses: boolean;
  terminalAckSeen: boolean;
  sawActiveState: boolean;
  activeCycleSettled: boolean;
  readonly pendingResponses: Array<{
    readonly response: ControllerEvent;
    readonly rawLine: string;
  }>;
};

type ControllerIdleWaitRequest = {
  readonly kind: ControllerCommandKind;
  readonly requiredReports: number;
  readonly timeoutMs: number;
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  idleReports: number;
};

export type StartControllerCommandOptions = {
  readonly kind: ControllerCommandKind;
  readonly label: string;
  readonly command: string;
  readonly action?: LaserSafetyAction;
  readonly source?: TranscriptSource;
  readonly timeoutMs?: number;
  readonly timeoutMode?: ControllerCommandTimeoutMode;
  readonly completion?: ControllerCommandCompletion;
};

export type FreshIdleWaitOptions = {
  readonly kind: ControllerCommandKind;
  readonly requiredReports?: number;
  readonly timeoutMs?: number;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 8_000;
const DEFAULT_IDLE_TIMEOUT_MS = 8_000;

type ControllerCommandTimeoutMode = 'fixed' | 'non-idle-status-activity';
export type ControllerCommandCompletion = 'terminal' | 'terminal-and-idle';

export function startControllerCommand(
  refs: ControllerLifecycleRefs,
  write: CommandWriteFn,
  options: StartControllerCommandOptions,
): Promise<ReadonlyArray<string>> {
  if (refs.controllerCommand !== null) {
    return Promise.reject(
      new Error('A controller command is already waiting for acknowledgement.'),
    );
  }
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const request: ControllerCommandRequest = {
      kind: options.kind,
      label: options.label,
      timeoutMs,
      timeoutMode: options.timeoutMode ?? 'fixed',
      completion: options.completion ?? 'terminal',
      responses: [],
      resolve,
      reject,
      acceptingResponses: false,
      terminalAckSeen: false,
      sawActiveState: false,
      activeCycleSettled: false,
      pendingResponses: [],
      timer: setTimeout(() => {
        finishControllerCommand(refs, request, 'reject', `${options.label} timed out.`);
      }, timeoutMs),
    };
    refs.controllerCommand = request;
    write(options.command, options.action, options.source)
      .then(() => {
        if (refs.controllerCommand !== request) return;
        request.acceptingResponses = true;
        const pending = request.pendingResponses.splice(0);
        for (const item of pending) {
          consumeControllerCommandResponse(refs, item.response, item.rawLine);
          if (refs.controllerCommand !== request) break;
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        finishControllerCommand(refs, request, 'reject', message);
      });
  });
}

export function consumeControllerCommandResponse(
  refs: ControllerLifecycleRefs,
  response: ControllerEvent,
  rawLine: string,
): boolean {
  const request = refs.controllerCommand;
  if (request === null) return false;
  if (!request.acceptingResponses) {
    // A fast adapter/controller can deliver a reply before conn.write()'s
    // Promise resolves. The safe-write ledger has already reserved ownership,
    // so retain semantic responses and replay them in wire order once the
    // transport accepts. Status/ALARM still continue through global handling.
    request.pendingResponses.push({ response, rawLine });
    return response.kind !== 'status' && response.kind !== 'alarm';
  }
  if (response.kind === 'ok') {
    request.terminalAckSeen = true;
    if (request.completion === 'terminal' || request.activeCycleSettled) {
      finishControllerCommand(refs, request, 'resolve');
    }
    return true;
  }
  if (response.kind === 'error') {
    finishControllerCommand(
      refs,
      request,
      'reject',
      response.raw ?? (response.code === null ? 'error' : `error:${response.code}`),
    );
    return true;
  }
  if (response.kind === 'alarm') {
    finishControllerCommand(refs, request, 'reject', `ALARM:${response.code}`);
    return true;
  }
  if (response.kind === 'status') {
    keepCommandAliveFromStatus(refs, request, response.report);
    observeCompositeCommandStatus(refs, request, response.report);
    return false;
  }
  request.responses.push(rawLine.trim());
  return true;
}

function observeCompositeCommandStatus(
  refs: ControllerLifecycleRefs,
  request: ControllerCommandRequest,
  report: StatusReport,
): void {
  if (request.completion !== 'terminal-and-idle') return;
  if (report.state === 'Alarm' || report.state === 'Sleep') return;
  if (report.state !== 'Idle') {
    request.sawActiveState = true;
    return;
  }
  if (request.sawActiveState) request.activeCycleSettled = true;
  // A post-ack Idle is sufficient for Falcon firmwares that do not expose an
  // active autofocus state. Conversely, when the active -> Idle cycle arrives
  // before the terminal ok, activeCycleSettled lets that later ok complete the
  // same request without losing either line to a Promise-continuation race.
  if (request.terminalAckSeen) finishControllerCommand(refs, request, 'resolve');
}

export function waitForFreshIdle(
  refs: ControllerLifecycleRefs,
  options: FreshIdleWaitOptions,
): Promise<void> {
  if (refs.controllerIdleWait !== null) {
    return Promise.reject(new Error('A controller Idle wait is already active.'));
  }
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    const request: ControllerIdleWaitRequest = {
      kind: options.kind,
      requiredReports: options.requiredReports ?? 1,
      timeoutMs,
      resolve,
      reject,
      idleReports: 0,
      timer: setTimeout(() => {
        finishIdleWait(refs, request, 'reject', 'Timed out waiting for fresh Idle.');
      }, timeoutMs),
    };
    refs.controllerIdleWait = request;
  });
}

export function waitForControllerResetBoundary(
  refs: ControllerLifecycleRefs,
  expectedEpoch: number,
  timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
): Promise<void> {
  if (refs.controllerResetWait != null) {
    return Promise.reject(new Error('A controller reset-boundary wait is already active.'));
  }
  return new Promise((resolve, reject) => {
    const request: ControllerResetWaitRequest = {
      expectedEpoch,
      resolve,
      reject,
      timer: setTimeout(() => {
        finishResetWait(refs, request, 'reject', 'Timed out waiting for controller reboot banner.');
      }, timeoutMs),
    };
    refs.controllerResetWait = request;
  });
}

export function observeControllerResetBoundary(refs: ControllerLifecycleRefs): void {
  const request = refs.controllerResetWait;
  if (request == null) return;
  if ((refs.writeEpoch ?? 0) <= request.expectedEpoch) return;
  finishResetWait(refs, request, 'resolve');
}

export function observeControllerIdleWait(
  set: SetFn,
  refs: ControllerLifecycleRefs,
  report: StatusReport,
): void {
  const request = refs.controllerIdleWait;
  if (request === null) return;
  if (report.state === 'Alarm' || report.state === 'Sleep') {
    finishIdleWait(refs, request, 'reject', `Controller entered ${report.state}.`);
    return;
  }
  // GRBL acks lines at parse time, so buffered motion legally outlasts any
  // fixed wall-clock budget (slow feeds run minutes past the last ok). Every
  // status report proves the controller is alive, so the timeout measures
  // status silence, not elapsed time.
  clearTimeout(request.timer);
  request.timer = setTimeout(() => {
    finishIdleWait(refs, request, 'reject', 'Timed out waiting for fresh Idle.');
  }, request.timeoutMs);
  request.idleReports = report.state === 'Idle' ? request.idleReports + 1 : 0;
  set((state) => updateOperationIdleReports(state, request.kind, request.idleReports));
  if (request.idleReports >= request.requiredReports) {
    finishIdleWait(refs, request, 'resolve');
  }
}

export function cancelControllerLifecycleRefs(
  refs: ControllerLifecycleRefs,
  message = 'Controller operation was cancelled.',
): void {
  const command = refs.controllerCommand;
  if (command !== null) finishControllerCommand(refs, command, 'reject', message);
  const idleWait = refs.controllerIdleWait;
  if (idleWait !== null) finishIdleWait(refs, idleWait, 'reject', message);
  const resetWait = refs.controllerResetWait;
  if (resetWait != null) finishResetWait(refs, resetWait, 'reject', message);
}

function finishControllerCommand(
  refs: ControllerLifecycleRefs,
  request: ControllerCommandRequest,
  mode: 'resolve' | 'reject',
  message?: string,
): void {
  if (refs.controllerCommand !== request) return;
  refs.controllerCommand = null;
  clearTimeout(request.timer);
  if (mode === 'resolve') request.resolve([...request.responses]);
  else request.reject(new Error(message ?? `${request.label} failed.`));
}

function keepCommandAliveFromStatus(
  refs: ControllerLifecycleRefs,
  request: ControllerCommandRequest,
  report: StatusReport,
): void {
  if (request.timeoutMode !== 'non-idle-status-activity') return;
  if (report.state === 'Idle' || report.state === 'Alarm' || report.state === 'Sleep') return;
  clearTimeout(request.timer);
  request.timer = setTimeout(() => {
    finishControllerCommand(refs, request, 'reject', `${request.label} timed out.`);
  }, request.timeoutMs);
}

function finishIdleWait(
  refs: ControllerLifecycleRefs,
  request: ControllerIdleWaitRequest,
  mode: 'resolve' | 'reject',
  message?: string,
): void {
  if (refs.controllerIdleWait !== request) return;
  refs.controllerIdleWait = null;
  clearTimeout(request.timer);
  if (mode === 'resolve') request.resolve();
  else request.reject(new Error(message ?? 'Controller did not report Idle.'));
}

function finishResetWait(
  refs: ControllerLifecycleRefs,
  request: ControllerResetWaitRequest,
  mode: 'resolve' | 'reject',
  message?: string,
): void {
  if (refs.controllerResetWait !== request) return;
  refs.controllerResetWait = null;
  clearTimeout(request.timer);
  if (mode === 'resolve') request.resolve();
  else request.reject(new Error(message ?? 'Controller reboot boundary was not observed.'));
}

function updateOperationIdleReports(
  state: LaserState,
  kind: ControllerCommandKind,
  idleReports: number,
): Partial<LaserState> {
  const operation = state.controllerOperation;
  if (operation === null || operation.kind !== kind) return {};
  if (
    operation.kind === 'connection-handshake' ||
    operation.kind === 'interactive-command' ||
    operation.kind === 'start-arming' ||
    operation.kind === 'work-z-recovery'
  ) {
    return {};
  }
  return { controllerOperation: { ...operation, idleReports } };
}
