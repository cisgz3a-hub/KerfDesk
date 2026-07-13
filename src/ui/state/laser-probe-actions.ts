// Store-facing probe transaction (ADR-103 G2). Every line is owned by the
// shared controller arbiter; after the caller's final retract/park, the active
// driver's planner fence and fresh Idle reports prove physical settlement.

import type { SerialConnection } from '../../platform/types';
import {
  startControllerCommand,
  waitForFreshIdle,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import {
  PROBE_LINE_TIMEOUT_MS,
  describeProbeResult,
  probeResultFromControllerFailure,
  type ProbeResult,
} from './probe-actions';
import { controllerErrorNotice, type LaserSafetyAction } from './laser-safety-notice';
import {
  motionOperationCommandBlockMessage,
  pushLog,
  setupBlockingJobCommandBlockMessage,
} from './laser-store-helpers';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type ProbeRefs = ControllerLifecycleRefs & {
  readonly connection: SerialConnection | null;
  readonly driver: { readonly commands: { readonly settleDwell: string } };
};
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

const PROBE_STABLE_IDLE_REPORTS = 2;

export function probeActions(
  set: SetFn,
  get: GetFn,
  refs: ProbeRefs,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'probe'> {
  return {
    probe: async (lines): Promise<ProbeResult> => {
      const preflight = probePreflight(get(), refs, lines);
      if (preflight !== null) return preflight;
      set((state) => ({
        probeBusy: true,
        controllerOperation: { kind: 'probe', phase: 'sequence', idleReports: 0 },
        workZZeroKnown: false,
        log: pushLog(state, '[lf2] Probe transaction started.'),
      }));
      let pendingLine = lines[0] ?? '';
      try {
        for (let index = 0; index < lines.length; index += 1) {
          pendingLine = lines[index] ?? '';
          await startControllerCommand(refs, safeWrite, {
            kind: 'probe',
            label: `probe line ${index + 1}`,
            command: `${pendingLine}\n`,
            action: 'probe',
            source: 'motion',
            timeoutMs: PROBE_LINE_TIMEOUT_MS,
            timeoutMode: 'non-idle-status-activity',
          });
        }
        setProbePhase(set, 'settling');
        pendingLine = refs.driver.commands.settleDwell;
        await startControllerCommand(refs, safeWrite, {
          kind: 'probe',
          label: 'probe settle marker',
          command: `${pendingLine}\n`,
          action: 'probe',
          source: 'system',
          timeoutMs: PROBE_LINE_TIMEOUT_MS,
          timeoutMode: 'non-idle-status-activity',
        });
        setProbePhase(set, 'awaiting-idle');
        pendingLine = 'fresh Idle after probe';
        await waitForFreshIdle(refs, {
          kind: 'probe',
          requiredReports: PROBE_STABLE_IDLE_REPORTS,
        });
        set((state) => ({
          controllerOperation:
            state.controllerOperation?.kind === 'probe' ? null : state.controllerOperation,
          probeBusy: false,
          workZZeroKnown: true,
          alarmCode: null,
          lastWriteError: null,
          log: pushLog(state, '[lf2] Probe transaction settled at fresh Idle.'),
        }));
        return { kind: 'ok' };
      } catch (error) {
        const result = probeResultFromControllerFailure(error, pendingLine);
        const described = describeProbeResult(result);
        set((state) => ({
          controllerOperation:
            state.controllerOperation?.kind === 'probe' ? null : state.controllerOperation,
          probeBusy: false,
          workZZeroKnown: false,
          // A failed transaction may have executed only part of its motion or
          // coordinate mutation. Drop stale Idle/position evidence until the
          // normal poll receives a fresh report.
          statusReport: null,
          ...(result.kind === 'probe-failed' || result.kind === 'alarm'
            ? { alarmCode: result.alarmCode }
            : {}),
          lastWriteError: described.message,
          safetyNotice:
            state.safetyNotice ??
            controllerErrorNotice(null, 'command', described.message, pendingLine),
          log: pushLog(state, `[lf2] Probe transaction failed: ${described.message}`),
        }));
        return result;
      }
    },
  };
}

function probePreflight(
  state: LaserState,
  refs: ProbeRefs,
  lines: ReadonlyArray<string>,
): ProbeResult | null {
  const reason = probeStateBlockReason(state, refs) ?? probeProtocolBlockReason(state, refs, lines);
  return reason === null ? null : { kind: 'preflight-failed', reason };
}

function probeStateBlockReason(state: LaserState, refs: ProbeRefs): string | null {
  const activeJobBlock = setupBlockingJobCommandBlockMessage(state);
  if (activeJobBlock !== null) return activeJobBlock;
  const motionBlock = motionOperationCommandBlockMessage(state);
  if (motionBlock !== null) return motionBlock;
  if (state.autofocusBusy) return 'Auto-focus is running.';
  if (state.probeBusy) return 'A probe cycle is already running.';
  if (state.pendingUntrackedAcks > 0 || refs.controllerCommand !== null) {
    return 'Wait for the previous controller command to be acknowledged before probing.';
  }
  if (refs.controllerIdleWait !== null) {
    return 'Wait for the active controller Idle check to finish before probing.';
  }
  return null;
}

function probeProtocolBlockReason(
  state: LaserState,
  refs: ProbeRefs,
  lines: ReadonlyArray<string>,
): string | null {
  if (refs.connection === null) return 'Not connected to a controller';
  if (lines.length === 0) return 'Probe sequence is empty';
  if (state.statusReport === null) {
    return 'Controller status is not known. Wait for a fresh Idle report before probing.';
  }
  if (state.statusReport.state !== 'Idle') {
    return `Machine must be Idle to probe (currently ${state.statusReport.state})`;
  }
  if (refs.driver.commands.settleDwell.length === 0) {
    return 'This controller has no planner-settle command for a qualified probe cycle.';
  }
  return null;
}

function setProbePhase(
  set: SetFn,
  phase: Extract<LaserState['controllerOperation'], { kind: 'probe' }>['phase'],
): void {
  set((state) =>
    state.controllerOperation?.kind === 'probe'
      ? { controllerOperation: { kind: 'probe', phase, idleReports: 0 } }
      : {},
  );
}
