// Store-facing probe transaction. The store accepts typed geometry, expands
// the audited sequence itself, owns every terminal response, and keeps Start
// locked until a planner fence plus fresh Idle reports prove settlement.

import type { SerialConnection } from '../../platform/types';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import {
  startControllerCommand,
  waitForFreshIdle,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import {
  PROBE_LINE_TIMEOUT_MS,
  probeResultFromControllerFailure,
  type ProbeResult,
} from './probe-actions';
import { failProbeTransaction } from './laser-probe-recovery';
import type { LaserSafetyAction } from './laser-safety-notice';
import { invalidProbeEvidence, probeLines, probePreflight } from './laser-probe-policy';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';
import { useStore } from './store';
import { captureWorkZZeroEvidence, selectedCncToolId } from './work-z-zero-evidence';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type ProbeRefs = ControllerLifecycleRefs & {
  readonly connection: SerialConnection | null;
  readonly driver: {
    readonly commands: { readonly settleDwell: string };
    readonly realtime: { readonly softReset: string | null };
  };
};
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

const PROBE_STABLE_IDLE_REPORTS = 2;
let nextProbeTransactionId = 1;

export function probeActions(
  set: SetFn,
  get: GetFn,
  refs: ProbeRefs,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'probe' | 'confirmProbePlateRemoved'> {
  return {
    probe: (request) => runProbe(set, get, refs, safeWrite, request),
    confirmProbePlateRemoved: () => set(confirmProbePlateRemovedPatch),
  };
}

async function runProbe(
  set: SetFn,
  get: GetFn,
  refs: ProbeRefs,
  safeWrite: SafeWriteFn,
  request: ProbeRequest,
): Promise<ProbeResult> {
  const lines = probeLines(request);
  const preflight = probePreflight(get(), refs, lines, request);
  if (preflight !== null) return preflight;
  const connection = refs.connection as SerialConnection;
  const toolId = selectedCncToolId(useStore.getState().project);
  const transactionId = reserveProbe(set, request.kind === 'corner');
  let pendingLine = lines[0] ?? '';
  try {
    for (let index = 0; index < lines.length; index += 1) {
      pendingLine = lines[index] ?? '';
      await sendProbeLine(refs, safeWrite, pendingLine, `probe line ${index + 1}`, 'motion');
      assertCurrentProbe(get(), refs, connection, transactionId);
    }
    setProbePhase(set, transactionId, 'settling');
    pendingLine = refs.driver.commands.settleDwell;
    await sendProbeLine(refs, safeWrite, pendingLine, 'probe settle marker', 'system');
    assertCurrentProbe(get(), refs, connection, transactionId);
    setProbePhase(set, transactionId, 'awaiting-idle');
    pendingLine = 'fresh Idle after probe';
    await waitForFreshIdle(refs, {
      kind: 'probe',
      requiredReports: PROBE_STABLE_IDLE_REPORTS,
    });
    assertCurrentProbe(get(), refs, connection, transactionId);
    completeProbe(set, transactionId, toolId);
    return { kind: 'ok' };
  } catch (error) {
    const result = probeResultFromControllerFailure(error, pendingLine);
    await failProbeTransaction(
      set,
      get,
      refs,
      safeWrite,
      connection,
      transactionId,
      result,
      pendingLine,
    );
    return result;
  }
}

function reserveProbe(set: SetFn, affectsXy: boolean): number {
  const transactionId = nextProbeTransactionId++;
  set((state) => ({
    probeBusy: true,
    controllerOperation: {
      kind: 'probe',
      phase: 'sequence',
      idleReports: 0,
      transactionId,
      affectsXy,
    },
    ...invalidProbeEvidence(affectsXy),
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    log: pushLog(state, `[lf2] Probe transaction ${transactionId} started.`),
  }));
  return transactionId;
}

function sendProbeLine(
  refs: ProbeRefs,
  safeWrite: SafeWriteFn,
  line: string,
  label: string,
  source: TranscriptSource,
): Promise<ReadonlyArray<string>> {
  return startControllerCommand(refs, safeWrite, {
    kind: 'probe',
    label,
    command: `${line}\n`,
    action: 'probe',
    source,
    timeoutMs: PROBE_LINE_TIMEOUT_MS,
    timeoutMode: 'non-idle-status-activity',
  });
}

function completeProbe(set: SetFn, transactionId: number, toolId: string | undefined): void {
  set((state) =>
    isCurrentProbe(state, transactionId)
      ? {
          controllerOperation: null,
          probeBusy: false,
          workZZeroEvidence: captureWorkZZeroEvidence('probe', state.workZReferenceEpoch, toolId),
          alarmCode: null,
          lastWriteError: null,
          log: pushLog(state, `[lf2] Probe transaction ${transactionId} settled at fresh Idle.`),
        }
      : {},
  );
}

function assertCurrentProbe(
  state: LaserState,
  refs: ProbeRefs,
  connection: SerialConnection,
  transactionId: number,
): void {
  if (refs.connection !== connection || !isCurrentProbe(state, transactionId)) {
    throw new Error('Probe transaction lost controller ownership.');
  }
}

function isCurrentProbe(state: LaserState, transactionId: number): boolean {
  return (
    state.controllerOperation?.kind === 'probe' &&
    state.controllerOperation.transactionId === transactionId
  );
}

function setProbePhase(
  set: SetFn,
  transactionId: number,
  phase: Extract<LaserState['controllerOperation'], { kind: 'probe' }>['phase'],
): void {
  set((state) => {
    const operation = state.controllerOperation;
    if (operation?.kind !== 'probe' || operation.transactionId !== transactionId) return {};
    return { controllerOperation: { ...operation, phase, idleReports: 0 } };
  });
}

function confirmProbePlateRemovedPatch(state: LaserState): Partial<LaserState> {
  const evidence = state.workZZeroEvidence;
  if (
    evidence?.source !== 'probe' ||
    evidence.referenceEpoch !== state.workZReferenceEpoch ||
    evidence.probePlateRemoved === true
  ) {
    return {};
  }
  return {
    workZZeroEvidence: { ...evidence, probePlateRemoved: true },
    log: pushLog(state, '[lf2] Operator confirmed the touch plate and probe lead are removed.'),
  };
}
