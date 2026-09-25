import type { StatusReport } from '../../core/controllers/grbl';
import type { ControllerEvent } from '../../core/controllers';
import { echoedCommandMatchesLine } from '../../core/controllers/controller-event';
import { skippedCommandReason, type LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';
import {
  cancelFreshControllerStatusWait,
  type ControllerStatusWaitRefs,
} from './laser-controller-status-wait';
import {
  cancelPauseResumeTransition,
  type PauseResumeTransitionRefs,
} from './laser-pause-resume-transition';
import type { UntrackedAckLedgerRefs } from './laser-untracked-ack-ledger';
import {
  cancelControllerResetWait,
  type ControllerResetWaitRefs,
} from './laser-controller-reset-wait';

export {
  observeControllerResetBoundary,
  waitForControllerResetBoundary,
} from './laser-controller-reset-wait';

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
  | 'controller-identity'
  | 'home'
  | 'post-job-settle'
  | 'probe'
  | 'interactive-command'
  | 'recovery'
  | 'start-arming'
  | 'work-z-recovery';

export type ControllerLifecycleRefs = ControllerStatusWaitRefs &
  PauseResumeTransitionRefs &
  ControllerResetWaitRefs & {
    controllerCommand: ControllerCommandRequest | null;
    controllerIdleWait: ControllerIdleWaitRequest | null;
    // Serial-session/reset generation. Late transport promises from an older
    // epoch must not mutate the current write/ack ledgers.
    writeEpoch?: number;
  } & UntrackedAckLedgerRefs;

type ControllerCommandRequest = {
  readonly kind: ControllerCommandKind;
  readonly label: string;
  readonly command: string;
  readonly timeoutMs: number;
  readonly timeoutMode: ControllerCommandTimeoutMode;
  readonly completion: ControllerCommandCompletion;
  readonly statusOwnership?: ControllerCommandStatusOwnership;
  readonly responses: string[];
  readonly resolve: (responses: ReadonlyArray<string>) => void;
  readonly reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  acceptingResponses: boolean;
  terminalAckSeen: boolean;
  /** Set when the controller skipped the command; its `ok` then refuses it. */
  refusal: string | null;
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
  readonly statusOwnership?: ControllerCommandStatusOwnership;
};

export type ControllerCommandStatusOwnership = 'cnc-start-settle-dwell';

export type FreshIdleWaitOptions = {
  readonly kind: ControllerCommandKind;
  readonly requiredReports?: number;
  readonly timeoutMs?: number;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 8_000;
const DEFAULT_IDLE_TIMEOUT_MS = 8_000;

/** The controller answered the owned line with a terminal `error:N`. GRBL-family
 * firmware returns it when the line fails to parse or validate, before running
 * it, so the line itself caused no motion. Distinct from ALARM, timeout and
 * cancellation, after which the machine state is uncertain. */
export class ControllerCommandRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControllerCommandRefusedError';
  }
}

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
      command: options.command,
      timeoutMs,
      timeoutMode: options.timeoutMode ?? 'fixed',
      completion: options.completion ?? 'terminal',
      ...(options.statusOwnership === undefined
        ? {}
        : { statusOwnership: options.statusOwnership }),
      responses: [],
      resolve,
      reject,
      acceptingResponses: false,
      terminalAckSeen: false,
      refusal: null,
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

/** Exact line owned by the active semantic command arbiter, if any. */
export function activeControllerCommandLine(refs: ControllerLifecycleRefs): string | undefined {
  return refs.controllerCommand?.command;
}

export function controllerCommandOwnsCncStartSettleDwell(refs: ControllerLifecycleRefs): boolean {
  return (
    refs.controllerCommand?.kind === 'start-arming' &&
    refs.controllerCommand.statusOwnership === 'cnc-start-settle-dwell'
  );
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
    acceptTerminalAck(refs, request);
    return true;
  }
  if (rejectCommandFromTerminalResponse(refs, request, response)) return true;
  if (response.kind === 'status') {
    keepCommandAliveFromStatus(refs, request, response.report);
    observeCompositeCommandStatus(refs, request, response.report);
    return false;
  }
  // Marlin prints `echo:busy: processing` every 2 s while a handler waits
  // (gcode.cpp host_keepalive), e.g. M400 or G28 during a long drain (MA-4).
  if (response.kind === 'busy') rearmActivityTimeout(refs, request);
  if (response.kind === 'unknown-command') return noteOwnedUnknownCommand(request, response);
  request.responses.push(rawLine.trim());
  return true;
}

function acceptTerminalAck(refs: ControllerLifecycleRefs, request: ControllerCommandRequest): void {
  request.terminalAckSeen = true;
  if (request.refusal !== null) {
    finishControllerCommand(
      refs,
      request,
      'reject',
      new ControllerCommandRefusedError(request.refusal),
    );
  } else if (request.completion === 'terminal' || request.activeCycleSettled) {
    finishControllerCommand(refs, request, 'resolve');
  }
}

// Marlin answers a command its build lacks with an "Unknown command" echo and
// then an ordinary `ok` for the same line; that `ok` refuses the command
// (MA-12). An echo naming another command belongs to an earlier line.
function noteOwnedUnknownCommand(
  request: ControllerCommandRequest,
  response: Extract<ControllerEvent, { readonly kind: 'unknown-command' }>,
): boolean {
  if (!echoedCommandMatchesLine(response.command, request.command)) return false;
  request.refusal = skippedCommandReason(response);
  return true;
}

function rejectCommandFromTerminalResponse(
  refs: ControllerLifecycleRefs,
  request: ControllerCommandRequest,
  response: ControllerEvent,
): boolean {
  if (response.kind === 'error') {
    finishControllerCommand(
      refs,
      request,
      'reject',
      new ControllerCommandRefusedError(
        response.raw ?? (response.code === null ? 'error' : `error:${response.code}`),
      ),
    );
    return true;
  }
  if (response.kind === 'resend') {
    finishControllerCommand(
      refs,
      request,
      'reject',
      `Controller requested unsupported line retransmission at ${response.line}.`,
    );
    return true;
  }
  if (response.kind !== 'alarm') return false;
  finishControllerCommand(refs, request, 'reject', `ALARM:${response.code}`);
  return true;
}

export function consumeOwnedControllerIdentityResponse(
  refs: ControllerLifecycleRefs,
  response: ControllerEvent,
  rawLine: string,
): boolean {
  if (refs.controllerCommand?.kind !== 'controller-identity') return false;
  if (response.kind !== 'welcome' || !/FIRMWARE_NAME:/i.test(rawLine)) return false;
  return consumeControllerCommandResponse(refs, response, rawLine);
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
  cancelControllerResetWait(refs, message);
  // Reject the encompassing transition first so teardown/Alarm/Stop remains
  // the fail-dark owner; the nested status-wait rejection must not launch a
  // duplicate reset from the transition's uncertainty handler.
  cancelPauseResumeTransition(refs, message);
  cancelFreshControllerStatusWait(refs, message);
}

function finishControllerCommand(
  refs: ControllerLifecycleRefs,
  request: ControllerCommandRequest,
  mode: 'resolve' | 'reject',
  message?: string | Error,
): void {
  if (refs.controllerCommand !== request) return;
  refs.controllerCommand = null;
  clearTimeout(request.timer);
  if (mode === 'resolve') request.resolve([...request.responses]);
  else if (message instanceof Error) request.reject(message);
  else request.reject(new Error(message ?? `${request.label} failed.`));
}

function keepCommandAliveFromStatus(
  refs: ControllerLifecycleRefs,
  request: ControllerCommandRequest,
  report: StatusReport,
): void {
  if (report.state === 'Idle' || report.state === 'Alarm' || report.state === 'Sleep') return;
  rearmActivityTimeout(refs, request);
}

/** An activity-timed command times out only after that long without the
 * controller showing it is working on it. */
function rearmActivityTimeout(
  refs: ControllerLifecycleRefs,
  request: ControllerCommandRequest,
): void {
  if (request.timeoutMode !== 'non-idle-status-activity') return;
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
