import { normalizeReportedMPosToMm } from '../../core/controllers/grbl/machine-envelope';
import { rotaryAppliesTo, type JobOriginPlacement } from '../../core/job';
import type { ExecutablePlanV1 } from '../../core/execution-plan';
import type { ControllerSettingsSnapshot, PreflightOptions } from '../../core/preflight';
import type { PreparedOutput } from '../../io/gcode';
import { buildExecutablePlanSidecar } from '../../io/gcode/executable-plan';
import {
  resolveJobPlacement,
  type JobPlacementSettings,
  type ResolvedJobPlacement,
} from '../job-placement';
import { canvasJobTimingPlan } from '../state/canvas-job-timing-plan';
import {
  buildCanvasMotionPlan,
  reportedWorkPositionMm,
  type CanvasMotionPlan,
} from '../state/canvas-motion-plan';
import { canvasExecutablePlan } from '../state/canvas-preview-motion';
import type { CncToolPlanEntry } from '../state/cnc-tool-plan';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import type { MachineStartSnapshot, StartJobPreparation } from './start-job-readiness';
import { buildPreparedJobMetrics } from './prepared-job-metrics';

export function withControllerReportUnits(
  machine: MachineStartSnapshot,
  controllerSettings: ControllerSettingsSnapshot | null,
): MachineStartSnapshot {
  return { ...machine, reportInches: controllerReportsInches(controllerSettings) };
}

export function controllerReportsInches(
  controllerSettings: ControllerSettingsSnapshot | null,
): boolean {
  return controllerSettings?.reportInches === true;
}

export function initialMachinePositionOption(machine: MachineStartSnapshot): {
  readonly preflightInitialMachinePosition?: { readonly x: number; readonly y: number };
} {
  const raw = inferCurrentMachinePosition(
    machine.statusReport,
    machine.wcoCache ?? machine.statusReport?.wco ?? null,
  );
  if (raw === null) return {};
  const [x, y] = normalizeReportedMPosToMm([raw.x, raw.y, raw.z], machine.reportInches === true);
  return { preflightInitialMachinePosition: { x, y } };
}

export function okPreparation(
  gcode: string,
  warnings: ReadonlyArray<string>,
  jobOrigin: JobOriginPlacement | undefined,
  toolPlan: ReadonlyArray<CncToolPlanEntry>,
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
  machine: MachineStartSnapshot,
  preflightMotionOffset: PreflightOptions['motionOffset'],
  reportInches: boolean,
  retentionKey: string,
): StartJobPreparation {
  const canvasPlan = buildCanvasMotionPlan({
    gcode,
    prepared,
    machine,
    ...(machine.statusQuery === undefined ? {} : { statusQuery: machine.statusQuery }),
    reportInches,
    retentionKey,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
  });
  const jobTimingPlan = canvasJobTimingPlan(
    gcode,
    prepared.project.device,
    reportedWorkPositionMm(machine, reportInches),
    {
      controllerSessionEpoch: machine.controllerSessionEpoch,
      positionEpoch: machine.trustedPositionEpoch,
      activeControllerKind: machine.activeControllerKind,
      detectedControllerKind: machine.detectedControllerKind,
    },
  );
  const executablePlan = executablePlanForCalculatedBounds({
    canvasPlan,
    gcode,
    prepared,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
  });
  return {
    ok: true,
    gcode,
    warnings,
    prepared,
    metrics: buildPreparedJobMetrics(prepared, jobOrigin, executablePlan),
    ...(preflightMotionOffset === undefined ? {} : { preflightMotionOffset }),
    canvasPlan,
    jobTimingPlan,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
    ...(toolPlan.length === 0 ? {} : { cncToolPlan: toolPlan }),
  };
}

function executablePlanForCalculatedBounds(args: {
  readonly canvasPlan: CanvasMotionPlan;
  readonly gcode: string;
  readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
  readonly jobOrigin?: JobOriginPlacement;
}): ExecutablePlanV1 | undefined {
  const associated = canvasExecutablePlan(args.canvasPlan);
  if (associated !== undefined) return associated;
  // Avoid constructing a plan that the bounds selector must reject for a
  // coordinate-basis mismatch. Realtime previews may already have associated
  // one; that exact object is reused above and the selector still rolls back.
  if (
    args.jobOrigin?.startFrom === 'current-position' ||
    rotaryAppliesTo(args.prepared.project.device, args.prepared.project.machine)
  ) {
    return undefined;
  }
  try {
    const sidecar = buildExecutablePlanSidecar(args.gcode, args.prepared.project);
    return sidecar.kind === 'ok' ? sidecar.plan : undefined;
  } catch {
    // Calculated bounds retain their established Job implementation when the
    // optional sidecar cannot be constructed. G-code and Start policy do not
    // depend on this migration seam.
    return undefined;
  }
}

export function resolveStartPlacement(
  jobPlacement: JobPlacementSettings,
  machine: MachineStartSnapshot,
  resolvedJobOrigin: JobOriginPlacement | undefined,
): ResolvedJobPlacement {
  if (resolvedJobOrigin === undefined) return resolveJobPlacement(jobPlacement, machine);
  const live = resolveJobPlacement(
    { startFrom: resolvedJobOrigin.startFrom, anchor: resolvedJobOrigin.anchor },
    machine,
  );
  if (!live.ok) return live;
  return {
    ok: true,
    jobOrigin: resolvedJobOrigin,
    ...(live.preflightMotionOffset === undefined
      ? {}
      : { preflightMotionOffset: live.preflightMotionOffset }),
  };
}

export function placementForResolvedOrigin(
  jobPlacement: JobPlacementSettings,
  resolvedJobOrigin: JobOriginPlacement | undefined,
): JobPlacementSettings {
  return resolvedJobOrigin === undefined
    ? jobPlacement
    : { startFrom: resolvedJobOrigin.startFrom, anchor: resolvedJobOrigin.anchor };
}
