import { useEffect, useMemo, useRef, useState } from 'react';
import type { StatusQueryCapability } from '../../core/controllers';
import type { OutputScope, Project } from '../../core/scene';
import { prepareOutputSnapshot } from '../../io/gcode';
import {
  resolveJobPlacement,
  type JobPlacementSettings,
  type ResolvedJobPlacement,
} from '../job-placement';
import { currentPrintCutOutputRegistration } from '../laser/print-cut-output';
import { renderVariableText } from '../text/render-variable-text';
import { useOutputScope } from '../state';
import {
  buildCanvasMarkerPlan,
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
  const interactionActive = useStore((state) => state.pendingUndo !== null);
  const outputScope = useOutputScope();
  const liveRun = useLaserStore((state) => state.liveCanvasRun ?? null);
  const machineRevision = useLaserStore(canvasMachineRevision);
  const laser = useMemo(
    () => canvasMachineSnapshot(useLaserStore.getState(), machineRevision),
    [machineRevision],
  );
  const rotaryRaster = useExperimentalLaserFeatures((state) => state.features.rotaryRaster);
  const printAndCut = useExperimentalLaserFeatures((state) => state.features.printAndCut);
  const firstRegistration = usePrintCutSessionStore((state) => state.first);
  const secondRegistration = usePrintCutSessionStore((state) => state.second);
  const showStartMarkers = useUiStore((state) => state.showCanvasStartMarkers);
  const placement = useMemo(
    () => resolveJobPlacement(placementSettings, laser),
    [placementSettings, laser],
  );
  const registrationKey = useMemo(
    () => JSON.stringify([printAndCut, firstRegistration, secondRegistration]),
    [firstRegistration, printAndCut, secondRegistration],
  );
  const idlePlan = useIdleCanvasMotionPlan({
    project,
    previewMode,
    liveRun,
    outputScope,
    placementSettings,
    placement,
    rotaryRaster,
    registrationKey,
    machineRevision,
    interactionActive,
    laser,
  });

  useClearStaleTerminalRun(liveRun, idlePlan?.current === true ? idlePlan.plan : null);

  if (previewMode) return null;
  if (liveRun !== null) return { plan: liveRun.plan, run: liveRun, showStartMarkers };
  return idlePlan === null ? null : { plan: idlePlan.plan, run: null, showStartMarkers };
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
  readonly machineRevision: string;
  readonly interactionActive: boolean;
  readonly laser: ReturnType<typeof canvasMachineSnapshot>;
};

type IdlePlanState = {
  readonly plan: CanvasMotionPlan;
  readonly project: Project;
  readonly outputScope: OutputScope;
  readonly placementSettings: JobPlacementSettings;
  readonly rotaryRaster: boolean;
  readonly registrationKey: string;
  readonly machineRevision: string;
};

type IdlePlanSelection = {
  readonly plan: CanvasMotionPlan;
  readonly current: boolean;
};

export const IDLE_CANVAS_PLAN_DELAY_MS = 200;

function useIdleCanvasMotionPlan(input: IdlePlanInput): IdlePlanSelection | null {
  const [idleState, setIdleState] = useState<IdlePlanState | null>(null);
  const requestRef = useRef(0);
  const inputRef = useRef(input);
  inputRef.current = input;
  useEffect(() => {
    const requestInput = inputRef.current;
    const request = ++requestRef.current;
    if (shouldClearIdlePlan(requestInput)) {
      setIdleState(null);
      return;
    }
    if (shouldDeferIdlePlan(requestInput)) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void buildIdleCanvasMotionPlan(requestInput, requestInput.placement).then((plan) => {
        if (cancelled || request !== requestRef.current) return;
        setIdleState(plan === null ? null : idlePlanState(plan, requestInput));
      });
    }, IDLE_CANVAS_PLAN_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    input.previewMode,
    input.liveRun?.lifecycle,
    input.project,
    input.outputScope,
    input.placementSettings,
    input.placement,
    input.rotaryRaster,
    input.registrationKey,
    input.machineRevision,
    input.interactionActive,
    input.laser,
  ]);
  if (shouldClearIdlePlan(input) || isActiveCanvasLifecycleOrNull(input.liveRun)) return null;
  if (idleState === null || !idleStateCanRemainVisible(idleState, input)) return null;
  return { plan: idleState.plan, current: idleStateMatches(idleState, input) };
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
  return buildCanvasMarkerPlan({
    prepared,
    machine: input.laser,
    statusQuery: statusQueryFor(input.project, input.laser),
    reportInches: input.laser.controllerSettings?.reportInches === true,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
    relativeView: !resolved.ok,
    retentionKey,
  });
}

function shouldClearIdlePlan(input: IdlePlanInput): boolean {
  return input.previewMode || input.project.scene.objects.length === 0;
}

function shouldDeferIdlePlan(input: IdlePlanInput): boolean {
  return (
    input.interactionActive ||
    isActiveCanvasLifecycleOrNull(input.liveRun) ||
    (input.laser.statusReport !== null && input.laser.statusReport.state !== 'Idle')
  );
}

function isActiveCanvasLifecycle(run: LiveCanvasRun): boolean {
  return (
    run.lifecycle === 'running' || run.lifecycle === 'paused' || run.lifecycle === 'tool-change'
  );
}

function isActiveCanvasLifecycleOrNull(run: LiveCanvasRun | null): boolean {
  return run !== null && isActiveCanvasLifecycle(run);
}

function idlePlanState(plan: CanvasMotionPlan, input: IdlePlanInput): IdlePlanState {
  return {
    plan,
    project: input.project,
    outputScope: input.outputScope,
    placementSettings: input.placementSettings,
    rotaryRaster: input.rotaryRaster,
    registrationKey: input.registrationKey,
    machineRevision: input.machineRevision,
  };
}

function idleStateMatches(
  state: IdlePlanState | null,
  input: IdlePlanInput,
): state is IdlePlanState {
  return (
    state !== null &&
    state.project === input.project &&
    state.outputScope === input.outputScope &&
    state.placementSettings === input.placementSettings &&
    state.rotaryRaster === input.rotaryRaster &&
    state.registrationKey === input.registrationKey &&
    state.machineRevision === input.machineRevision
  );
}

function idleStateCanRemainVisible(state: IdlePlanState, input: IdlePlanInput): boolean {
  return (
    state.project.device === input.project.device &&
    state.project.machine === input.project.machine &&
    state.outputScope === input.outputScope &&
    state.placementSettings === input.placementSettings &&
    state.rotaryRaster === input.rotaryRaster &&
    state.registrationKey === input.registrationKey &&
    state.machineRevision === input.machineRevision
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

function canvasMachineSnapshot(
  state: ReturnType<typeof useLaserStore.getState>,
  canvasRevision = '',
) {
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
    ...(canvasRevision === '' ? {} : { canvasRevision }),
  };
}

function canvasMachineRevision(state: ReturnType<typeof useLaserStore.getState>): string {
  const report = state.statusReport;
  const position =
    report === null
      ? 'unknown'
      : report.state === 'Idle'
        ? `idle:${axisKey(report.mPos)}:${axisKey(report.wPos)}:${axisKey(report.wco)}`
        : `busy:${report.state}`;
  return [
    state.connection.kind,
    state.capabilities.statusQuery,
    state.controllerSettings?.reportInches === true ? 'in' : 'mm',
    state.workOriginActive ? 'origin' : 'machine',
    String(state.trustedPositionEpoch ?? 0),
    axisKey(state.wcoCache),
    position,
  ].join('|');
}

function axisKey(
  axis: { readonly x: number; readonly y: number; readonly z: number } | null,
): string {
  if (axis === null) return '-';
  return `${axis.x.toFixed(3)},${axis.y.toFixed(3)},${axis.z.toFixed(3)}`;
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
