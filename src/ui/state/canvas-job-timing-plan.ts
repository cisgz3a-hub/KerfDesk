import type { ControllerKind, DeviceProfile } from '../../core/devices';
import { buildGcodeTimingPlan, type GcodeTimingPlanResult } from '../../core/gcode-time';
import { deviceProgramTimingOptions } from '../../core/gcode-time/program-timing-options';
import type { MotionPoint } from '../../core/job/motion-manifest';
import type { MachineKind } from '../../core/scene/machine';
import { fingerprintGcode, fingerprintsEqual, type GcodeFingerprint } from '../../core/recovery';
import {
  CANVAS_PROGRAM_ANALYSIS_SEGMENT_BUDGET,
  canvasProgramExceedsLineBudget,
} from './canvas-program-analysis-budget';

const INITIAL_POSITION_TOLERANCE_MM = 0.05;

export type CanvasJobTimingEvidence = {
  readonly fingerprint: GcodeFingerprint;
  readonly initialPosition: MotionPoint | null;
  readonly controllerSessionEpoch: number | undefined;
  readonly positionEpoch: number | undefined;
  readonly activeControllerKind: ControllerKind | null | undefined;
  readonly detectedControllerKind: ControllerKind | null | undefined;
};

export type CanvasJobTimingPlanResult = GcodeTimingPlanResult & {
  readonly evidence: CanvasJobTimingEvidence;
};

export type CanvasJobTimingContext = {
  readonly machineKind?: MachineKind;
  readonly controllerSessionEpoch: number | undefined;
  readonly positionEpoch: number | undefined;
  readonly activeControllerKind: ControllerKind | null | undefined;
  readonly detectedControllerKind: ControllerKind | null | undefined;
};

export function canvasJobTimingPlan(
  gcode: string,
  device: DeviceProfile,
  initialPosition: MotionPoint | null,
  context: CanvasJobTimingContext,
  machineKind: MachineKind = 'laser',
): CanvasJobTimingPlanResult {
  const evidence: CanvasJobTimingEvidence = {
    fingerprint: fingerprintGcode(gcode),
    initialPosition,
    ...context,
  };
  if (canvasProgramExceedsLineBudget(gcode)) {
    return {
      kind: 'unavailable',
      reason: 'Exact emitted program exceeds the live countdown line budget.',
      evidence,
    };
  }
  if (initialPosition === null || !isFinitePosition(initialPosition)) {
    return {
      kind: 'unavailable',
      reason: 'current controller position is unavailable for exact emitted-program timing',
      evidence,
    };
  }
  if (context.activeControllerKind == null) {
    return {
      kind: 'unavailable',
      reason: 'active controller family is unavailable for exact emitted-program dwell timing',
      evidence,
    };
  }
  const result = buildGcodeTimingPlan(
    gcode,
    {
      accelMmPerSec2: device.accelMmPerSec2,
      junctionDeviationMm: device.junctionDeviationMm,
      maxFeedMmPerMin: device.maxFeed,
    },
    initialPosition,
    {
      ...deviceProgramTimingOptions(
        device,
        context.machineKind ?? machineKind,
        context.activeControllerKind,
      ),
      maxSegments: CANVAS_PROGRAM_ANALYSIS_SEGMENT_BUDGET,
    },
  );
  if (
    result.kind === 'ok' &&
    result.plan.dwellSeconds > 0 &&
    (context.detectedControllerKind == null ||
      usesMillisecondDwellP(context.activeControllerKind) ||
      usesMillisecondDwellP(context.detectedControllerKind))
  ) {
    return {
      kind: 'unavailable',
      reason: 'current-session controller evidence cannot prove G4 P dwell uses seconds',
      evidence,
    };
  }
  return { ...result, evidence };
}

export function validatedCanvasJobTimingPlan(
  gcode: string,
  result: CanvasJobTimingPlanResult | undefined,
  current: CanvasJobTimingContext & { readonly initialPosition: MotionPoint | null },
): GcodeTimingPlanResult | undefined {
  if (result === undefined || result.kind !== 'ok') return result;
  const evidence = result.evidence;
  const currentFingerprint = fingerprintGcode(gcode);
  const isEvidenceMatch =
    fingerprintsEqual(evidence.fingerprint, currentFingerprint) &&
    evidence.controllerSessionEpoch === current.controllerSessionEpoch &&
    evidence.positionEpoch === current.positionEpoch &&
    evidence.activeControllerKind === current.activeControllerKind &&
    evidence.detectedControllerKind === current.detectedControllerKind &&
    positionsMatch(evidence.initialPosition, current.initialPosition);
  return isEvidenceMatch
    ? result
    : {
        kind: 'unavailable',
        reason: 'exact emitted-program timing evidence changed before controller handoff',
      };
}

function isFinitePosition(position: MotionPoint): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

function positionsMatch(left: MotionPoint | null, right: MotionPoint | null): boolean {
  if (left === null || right === null) return false;
  return (
    Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z) <=
    INITIAL_POSITION_TOLERANCE_MM
  );
}

function usesMillisecondDwellP(controllerKind: ControllerKind): boolean {
  return controllerKind === 'marlin' || controllerKind === 'smoothieware';
}
