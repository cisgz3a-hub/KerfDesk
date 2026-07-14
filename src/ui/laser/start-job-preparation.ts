import type { JobOriginPlacement } from '../../core/job';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { PreparedOutput } from '../../io/gcode';
import {
  resolveJobPlacement,
  type JobPlacementSettings,
  type ResolvedJobPlacement,
} from '../job-placement';
import { buildCanvasMotionPlan } from '../state/canvas-motion-plan';
import type { CncToolPlanEntry } from '../state/cnc-tool-plan';
import type { MachineStartSnapshot, StartJobPreparation } from './start-job-readiness';

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

export function okPreparation(
  gcode: string,
  warnings: ReadonlyArray<string>,
  jobOrigin: JobOriginPlacement | undefined,
  toolPlan: ReadonlyArray<CncToolPlanEntry>,
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
  machine: MachineStartSnapshot,
  reportInches: boolean,
  retentionKey: string,
): StartJobPreparation {
  return {
    ok: true,
    gcode,
    warnings,
    canvasPlan: buildCanvasMotionPlan({
      gcode,
      prepared,
      machine,
      ...(machine.statusQuery === undefined ? {} : { statusQuery: machine.statusQuery }),
      reportInches,
      retentionKey,
      ...(jobOrigin === undefined ? {} : { jobOrigin }),
    }),
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
