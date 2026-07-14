import { useEffect, useMemo, useRef, useState } from 'react';
import type { StatusQueryCapability } from '../../core/controllers';
import { profileSupportsCapability } from '../../core/devices';
import type { OutputScope, Project } from '../../core/scene';
import { emitPreparedGcode, prepareOutputSnapshot } from '../../io/gcode';
import {
  resolveJobPlacement,
  type JobPlacementSettings,
  type ResolvedJobPlacement,
} from '../job-placement';
import { currentPrintCutOutputRegistration } from '../laser/print-cut-output';
import { renderVariableText } from '../text/render-variable-text';
import { useOutputScope } from '../state';
import {
  buildCanvasMotionPlan,
  canvasPlanRetentionKey,
  type CanvasMotionPlan,
  type LiveCanvasRun,
} from '../state/canvas-motion-plan';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import type { CanvasMotionOverlay } from './draw-canvas-motion';

export function useCanvasMotionOverlay(
  project: Project,
  previewMode: boolean,
): CanvasMotionOverlay | null {
  const placementSettings = useStore((state) => state.jobPlacement);
  const outputScope = useOutputScope();
  const liveRun = useLaserStore((state) => state.liveCanvasRun ?? null);
  const laser = useLaserStore(canvasMachineSnapshot);
  const rotaryRaster = useExperimentalLaserFeatures((state) => state.features.rotaryRaster);
  const printAndCut = useExperimentalLaserFeatures((state) => state.features.printAndCut);
  const firstRegistration = usePrintCutSessionStore((state) => state.first);
  const secondRegistration = usePrintCutSessionStore((state) => state.second);
  const showStartMarkers = useUiStore((state) => state.showCanvasStartMarkers);
  const placement = useMemo(
    () => resolveJobPlacement(placementSettings, laser),
    [placementSettings, laser],
  );
  const registrationKey = JSON.stringify([printAndCut, firstRegistration, secondRegistration]);
  const idlePlan = useIdleCanvasMotionPlan({
    project,
    previewMode,
    liveRun,
    outputScope,
    placementSettings,
    placement,
    rotaryRaster,
    registrationKey,
    laser,
  });

  useClearStaleTerminalRun(liveRun, idlePlan);

  if (previewMode) return null;
  if (liveRun !== null) return { plan: liveRun.plan, run: liveRun, showStartMarkers };
  return idlePlan === null ? null : { plan: idlePlan, run: null, showStartMarkers };
}

type IdlePlanInput = {
  readonly project: Project;
  readonly previewMode: boolean;
  readonly liveRun: LiveCanvasRun | null;
  readonly outputScope: OutputScope;
  readonly placementSettings: JobPlacementSettings;
  readonly placement: ResolvedJobPlacement;
  readonly rotaryRaster: boolean;
  readonly registrationKey: string;
  readonly laser: ReturnType<typeof canvasMachineSnapshot>;
};

function useIdleCanvasMotionPlan(input: IdlePlanInput): CanvasMotionPlan | null {
  const [idlePlan, setIdlePlan] = useState<CanvasMotionPlan | null>(null);
  const placementKey = useMemo(() => JSON.stringify(input.placement), [input.placement]);
  const registration = currentPrintCutOutputRegistration(input.project);
  const planKey = canvasPlanRetentionKey(
    input.project,
    input.outputScope,
    input.placementSettings,
    registration,
  );
  const machineKey = JSON.stringify(input.laser);
  const placementRef = useRef(input.placement);
  const inputRef = useRef(input);
  placementRef.current = input.placement;
  inputRef.current = input;
  useEffect(() => {
    if (shouldHideIdlePlan(inputRef.current)) {
      setIdlePlan(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void buildIdleCanvasMotionPlan(inputRef.current, placementRef.current).then((plan) => {
        if (!cancelled) setIdlePlan(plan);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    input.previewMode,
    input.liveRun?.lifecycle,
    planKey,
    placementKey,
    input.rotaryRaster,
    input.registrationKey,
    machineKey,
  ]);
  return idlePlan;
}

export async function buildIdleCanvasMotionPlan(
  input: IdlePlanInput,
  resolved: ResolvedJobPlacement,
): Promise<CanvasMotionPlan | null> {
  const jobOrigin = resolved.ok ? resolved.jobOrigin : undefined;
  const registration = currentPrintCutOutputRegistration(input.project);
  const retentionKey = canvasPlanRetentionKey(
    input.project,
    input.outputScope,
    input.placementSettings,
    registration,
  );
  const prepared = await prepareOutputSnapshot(input.project, {
    clock: () => new Date(),
    renderVariableText,
    ...(registration === undefined ? {} : { registration }),
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
    outputScope: input.outputScope,
  });
  if (!prepared.ok) return null;
  const emitted = emitPreparedGcode(prepared, {
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
    outputScope: input.outputScope,
    allowRotaryRaster:
      input.rotaryRaster && profileSupportsCapability(input.project.device, 'rotary'),
  });
  if (!emitted.preflight.ok || emitted.gcode.length === 0) return null;
  return buildCanvasMotionPlan({
    gcode: emitted.gcode,
    prepared,
    machine: input.laser,
    statusQuery: statusQueryFor(input.project, input.laser),
    reportInches: input.laser.controllerSettings?.reportInches === true,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
    relativeView: !resolved.ok,
    retentionKey,
  });
}

function shouldHideIdlePlan(input: IdlePlanInput): boolean {
  return (
    input.previewMode ||
    input.project.scene.objects.length === 0 ||
    (input.liveRun !== null && isActiveCanvasLifecycle(input.liveRun))
  );
}

function isActiveCanvasLifecycle(run: LiveCanvasRun): boolean {
  return (
    run.lifecycle === 'running' || run.lifecycle === 'paused' || run.lifecycle === 'tool-change'
  );
}

function useClearStaleTerminalRun(
  liveRun: LiveCanvasRun | null,
  idlePlan: CanvasMotionPlan | null,
): void {
  useEffect(() => {
    if (liveRun === null || idlePlan === null || isActiveCanvasLifecycle(liveRun)) return;
    if (liveRun.plan.retentionKey === idlePlan.retentionKey) return;
    useLaserStore.setState({ liveCanvasRun: null });
  }, [idlePlan, liveRun]);
}

function canvasMachineSnapshot(state: ReturnType<typeof useLaserStore.getState>) {
  return {
    connection: state.connection,
    statusReport: state.statusReport,
    alarmCode: state.alarmCode,
    hasActiveStreamer: isActiveJob(state.streamer),
    controllerSettings: state.controllerSettings,
    reportInches: state.controllerSettings?.reportInches === true,
    workOriginActive: state.workOriginActive,
    wcoCache: state.wcoCache,
    trustedPositionEpoch: state.trustedPositionEpoch ?? 0,
    statusQuery: state.capabilities.statusQuery,
  };
}

function statusQueryFor(
  project: Project,
  laser: ReturnType<typeof canvasMachineSnapshot>,
): StatusQueryCapability {
  if (laser.connection.kind === 'connected') return laser.statusQuery;
  if (project.device.controllerKind === 'marlin') return 'queued-poll';
  if (project.device.controllerKind === 'ruida') return 'none';
  return 'realtime-report';
}
