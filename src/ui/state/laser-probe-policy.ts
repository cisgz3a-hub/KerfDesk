import { buildCornerProbeLines, buildZProbeLines } from '../../core/controllers/grbl';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import type { SerialConnection } from '../../platform/types';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import {
  motionOperationCommandBlockMessage,
  setupBlockingJobCommandBlockMessage,
} from './laser-store-helpers';
import type { LaserState } from './laser-store';
import type { ProbeResult } from './probe-actions';

type ProbePolicyRefs = ControllerLifecycleRefs & {
  readonly connection: SerialConnection | null;
  readonly driver: { readonly commands: { readonly settleDwell: string } };
};

export function probeLines(request: ProbeRequest): ReadonlyArray<string> {
  if (!validProbeRequest(request)) return [];
  const motionLines =
    request.kind === 'z' ? buildZProbeLines(request.params) : buildCornerProbeLines(request.params);
  // Current status must already prove spindle speed 0. These commands also
  // force the commanded spindle/coolant state off before probe motion queues.
  return ['M5', 'M9', ...motionLines];
}

export function probePreflight(
  state: LaserState,
  refs: ProbePolicyRefs,
  lines: ReadonlyArray<string>,
): ProbeResult | null {
  const reason = probeStateBlockReason(state, refs) ?? probeProtocolBlockReason(state, refs, lines);
  return reason === null ? null : { kind: 'preflight-failed', reason };
}

export function invalidProbeEvidence(affectsXy: boolean): Partial<LaserState> {
  const common: Partial<LaserState> = {
    workZZeroEvidence: null,
  };
  return affectsXy
    ? {
        ...common,
        wcoCache: null,
        frameVerification: null,
        workOriginActive: true,
        workOriginSource: 'unknown',
      }
    : common;
}

function validProbeRequest(request: ProbeRequest): boolean {
  if (request === null || typeof request !== 'object') return false;
  if (request.kind !== 'z' && request.kind !== 'corner') return false;
  if (request.params === null || typeof request.params !== 'object') return false;
  if (
    request.kind === 'corner' &&
    !['front-left', 'front-right', 'back-left', 'back-right'].includes(request.params.corner)
  ) {
    return false;
  }
  const values = [
    request.params.plateThicknessMm,
    request.params.seekFeedMmPerMin,
    request.params.probeFeedMmPerMin,
    request.params.maxTravelMm,
    request.params.retractMm,
    ...(request.kind === 'corner'
      ? [request.params.bitDiameterMm, request.params.sideDropMm, request.params.sideClearanceMm]
      : []),
  ];
  return values.every((value) => Number.isFinite(value) && value > 0);
}

function probeStateBlockReason(state: LaserState, refs: ProbePolicyRefs): string | null {
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
  refs: ProbePolicyRefs,
  lines: ReadonlyArray<string>,
): string | null {
  if (refs.connection === null) return 'Not connected to a controller';
  if (lines.length === 0) return 'Probe request is invalid';
  if (state.statusReport === null) {
    return 'Controller status is not known. Wait for a fresh Idle report before probing.';
  }
  if (state.statusReport.state !== 'Idle') {
    return `Machine must be Idle to probe (currently ${state.statusReport.state})`;
  }
  if (state.statusReport.spindle === null) {
    return 'Spindle state is not known. Wait for a status report that proves the spindle is off.';
  }
  if (state.statusReport.spindle !== 0) return 'Spindle must be off before probing.';
  if (refs.driver.commands.settleDwell.length === 0) {
    return 'This controller has no planner-settle command for a qualified probe cycle.';
  }
  return null;
}
