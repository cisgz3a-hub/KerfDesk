import { normalizeReportedMPosToMm } from '../../core/controllers/grbl/machine-envelope';
import type { JobOriginPlacement } from '../../core/job';
import type { ControllerSettingsSnapshot, PreflightOptions } from '../../core/preflight';
import type { PreparedOutput } from '../../io/gcode';
import {
  resolveJobPlacement,
  type JobPlacementSettings,
  type ResolvedJobPlacement,
} from '../job-placement';
import { canvasJobTimingPlan } from '../state/canvas-job-timing-plan';
import { buildCanvasMotionPlan, reportedWorkPositionMm } from '../state/canvas-motion-plan';
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
  return {
    ok: true,
    gcode,
    warnings,
    prepared,
    metrics: buildPreparedJobMetrics(prepared, jobOrigin),
    ...(preflightMotionOffset === undefined ? {} : { preflightMotionOffset }),
    canvasPlan,
    jobTimingPlan,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
    ...(toolPlan.length === 0 ? {} : { cncToolPlan: toolPlan }),
  };
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
