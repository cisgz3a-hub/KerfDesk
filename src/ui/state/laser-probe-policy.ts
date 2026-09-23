import { buildCornerProbeLines, buildZProbeLines } from '../../core/controllers/grbl';
import {
  MAX_CORNER_PROBE_DIMENSION_MM,
  PROBE_GCODE_RESOLUTION_MM,
  validateCornerProbeGeometry,
} from '../../core/controllers/grbl/corner-probe-geometry';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import type { SerialConnection } from '../../platform/types';
import { cncAccessoryStartIssue } from './cnc-accessory-readiness';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import {
  mpgCommandBlockMessage,
  motionOperationCommandBlockMessage,
  setupBlockingJobCommandBlockMessage,
} from './laser-store-helpers';
import type { LaserState } from './laser-store';
import type { ProbeResult } from './probe-actions';

type ProbePolicyRefs = ControllerLifecycleRefs & {
  readonly connection: SerialConnection | null;
  readonly driver: { readonly commands: { readonly settleDwell: string } };
};

const MAX_PROBE_FEED_MM_PER_MIN = 10_000;
const FLOAT_TOLERANCE = 1e-9;

export function probeLines(request: ProbeRequest): ReadonlyArray<string> {
  if (probeRequestBlockReason(request) !== null) return [];
  const motionLines =
    request.kind === 'z' ? buildZProbeLines(request.params) : buildCornerProbeLines(request.params);
  // Current status must already prove the spindle is off. These commands also
  // force the commanded spindle/coolant state off before probe motion queues.
  return ['M5', 'M9', ...motionLines];
}

export function probePreflight(
  state: LaserState,
  refs: ProbePolicyRefs,
  lines: ReadonlyArray<string>,
  request: ProbeRequest,
): ProbeResult | null {
  const reason =
    probeStateBlockReason(state, refs) ?? probeProtocolBlockReason(state, refs, lines, request);
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
        framedRun: null,
        frameTrace: null,
        workOriginActive: true,
        workOriginSource: 'unknown',
      }
    : common;
}

function probeRequestBlockReason(request: ProbeRequest): string | null {
  if (!hasProbeRequestShape(request)) return 'Probe request is invalid';
  const dimensions = [
    request.params.plateThicknessMm,
    request.params.maxTravelMm,
    request.params.retractMm,
    ...(request.kind === 'corner'
      ? [
          request.params.bitDiameterMm,
          request.params.plateCenterOffsetXmm,
          request.params.plateCenterOffsetYmm,
          request.params.sideDropMm,
          request.params.sideClearanceMm,
        ]
      : []),
  ];
  const feeds = [request.params.seekFeedMmPerMin, request.params.probeFeedMmPerMin];
  if (!dimensions.every((value) => validProtocolNumber(value, MAX_CORNER_PROBE_DIMENSION_MM))) {
    return 'Probe dimensions must be positive, at most 100 mm, and use at most 0.001 mm precision';
  }
  if (!feeds.every((value) => validProtocolNumber(value, MAX_PROBE_FEED_MM_PER_MIN))) {
    return 'Probe feeds must be positive, at most 10000 mm/min, and use at most 0.001 precision';
  }
  if (request.params.probeFeedMmPerMin >= request.params.seekFeedMmPerMin) {
    return 'Slow probe feed must be lower than the seek feed';
  }
  if (request.kind === 'z') return null;
  const geometry = validateCornerProbeGeometry(request.params);
  return geometry.kind === 'invalid' ? geometry.reason : null;
}

function validProtocolNumber(value: number, maximum: number): boolean {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) return false;
  const resolutionUnits = value / PROBE_GCODE_RESOLUTION_MM;
  if (Math.abs(resolutionUnits - Math.round(resolutionUnits)) >= FLOAT_TOLERANCE) {
    return false;
  }
  return true;
}

function hasProbeRequestShape(request: ProbeRequest): boolean {
  if (request === null || typeof request !== 'object') return false;
  if (request.kind !== 'z' && request.kind !== 'corner') return false;
  if (request.params === null || typeof request.params !== 'object') return false;
  return (
    request.kind === 'z' ||
    ['front-left', 'front-right', 'back-left', 'back-right'].includes(request.params.corner)
  );
}

function probeStateBlockReason(state: LaserState, refs: ProbePolicyRefs): string | null {
  const activeJobBlock = setupBlockingJobCommandBlockMessage(state);
  if (activeJobBlock !== null) return activeJobBlock;
  const motionBlock = motionOperationCommandBlockMessage(state);
  if (motionBlock !== null) return motionBlock;
  const mpgBlock = mpgCommandBlockMessage(state);
  if (mpgBlock !== null) return mpgBlock;
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
  request: ProbeRequest,
): string | null {
  if (refs.connection === null) return 'Not connected to a controller';
  const requestBlock = probeRequestBlockReason(request);
  if (requestBlock !== null) return requestBlock;
  if (lines.length === 0) return 'Probe request is invalid';
  if (state.statusReport === null) {
    return 'Controller status is not known. Wait for a fresh Idle report before probing.';
  }
  if (state.statusReport.state !== 'Idle') {
    return `Machine must be Idle to probe (currently ${state.statusReport.state})`;
  }
  const spindleBlock = spindleOffBlockReason(state.statusReport.spindle, state.accessoryCache);
  if (spindleBlock !== null) return spindleBlock;
  if (refs.driver.commands.settleDwell.length === 0) {
    return 'This controller has no planner-settle command for a qualified probe cycle.';
  }
  return null;
}

const SPINDLE_ON_REASON = 'Spindle must be off before probing.';
const SPINDLE_UNKNOWN_REASON =
  'Spindle state is not known yet. Probing needs a status report that proves the spindle is ' +
  'off: an FS: spindle speed of 0, or an Ov: override field without A:S or A:C. If the ' +
  'controller never reports either, enable its override (Ov:) status field.';

// A current `FS:` speed is the direct proof. Builds without a variable
// spindle print `F:` (feed only) instead, so the speed is never known there:
// GRBL 1.1 without VARIABLE_SPINDLE, grblHAL with an on/off spindle. Both
// still report the accessory state: `A:` rides with `Ov:` and names S/C while
// the spindle turns, so an `Ov:` without `A:S`/`A:C` proves it is off, and a
// spindle change forces the next report to carry it. The accessory cache
// holds that observation.
// https://github.com/gnea/grbl/blob/master/grbl/report.c
// https://github.com/grblHAL/core/blob/master/report.c
function spindleOffBlockReason(
  speed: number | null,
  accessories: LaserState['accessoryCache'],
): string | null {
  if (speed !== null) return speed === 0 ? null : SPINDLE_ON_REASON;
  if (accessories == null) return SPINDLE_UNKNOWN_REASON;
  if (accessories.spindleCw || accessories.spindleCcw) return SPINDLE_ON_REASON;
  // A secondary spindle, an encoder fault or a pending firmware tool change
  // leave the spindle state unproven; say which.
  if (
    accessories.secondarySpindlePresent === true ||
    accessories.spindleEncoderFault === true ||
    accessories.toolChangePending === true
  ) {
    return cncAccessoryStartIssue('cnc', accessories) ?? SPINDLE_UNKNOWN_REASON;
  }
  return null;
}
