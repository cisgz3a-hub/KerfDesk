import { type LaserControllerOperation } from './laser-controller-operation';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import { controllerErrorNotice, type LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;

export type OriginSafeWrite = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

export type OriginCommandWriter = (write: (line: string) => Promise<void>) => Promise<void>;

export async function runOriginTransaction(
  set: SetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: OriginSafeWrite,
  label: string,
  writeCommands: OriginCommandWriter,
  successPatch: () => Partial<LaserState>,
): Promise<void> {
  const operation: LaserControllerOperation = {
    kind: 'interactive-command',
    phase: 'command',
    label,
  };
  let pendingLine = '';
  set({ controllerOperation: operation, lastWriteError: null });
  try {
    await writeCommands(async (line) => {
      pendingLine = line;
      await startControllerCommand(refs, safeWrite, {
        kind: 'interactive-command',
        label,
        command: line,
        action: 'origin',
        source: 'origin',
      });
    });
    set((state) => ({
      ...successPatch(),
      controllerOperation:
        state.controllerOperation === operation ? null : state.controllerOperation,
      lastWriteError: null,
      log: pushLog(state, `[lf2] ${label} acknowledged by the controller.`),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    set((state) => ({
      ...unknownOriginPatch(),
      ...originControllerFailurePatch(state, message, pendingLine),
      controllerOperation:
        state.controllerOperation === operation ? null : state.controllerOperation,
      lastWriteError: message,
      log: pushLog(
        state,
        `[lf2] ${label} failed while waiting on ${pendingLine.trim() || 'the controller'}. Work-origin state is unknown: ${message}`,
      ),
    }));
    throw error instanceof Error ? error : new Error(message);
  }
}

export function unknownOriginPatch(): Partial<LaserState> {
  return {
    workOriginActive: true,
    workOriginSource: 'unknown',
    workZZeroKnown: false,
    workZZeroEvidence: null,
    wcoCache: null,
    frameVerification: null,
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
