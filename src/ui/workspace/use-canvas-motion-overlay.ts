import { useEffect, useMemo, useRef, useState } from 'react';
import type { StatusQueryCapability } from '../../core/controllers';
import type { OutputScope, Project } from '../../core/scene';
import {
  resolveJobPlacement,
  type JobPlacementSettings,
  type ResolvedJobPlacement,
} from '../job-placement';
import { currentPrintCutOutputRegistration } from '../laser/print-cut-output';
import { useOutputScope } from '../state';
import { type CanvasMotionPlan, type LiveCanvasRun } from '../state/canvas-motion-plan';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { useCanvasViewStore } from '../state/canvas-view-store';
import type { CanvasMotionOverlay } from './draw-canvas-motion';
import { costlyCanvasPreparation } from './canvas-preparation-policy';
import {
  buildIdleCanvasMotionPlanFromRequest,
  type IdleCanvasMotionPlanRequest,
} from './idle-canvas-motion-plan';
import {
  cancelIdleCanvasMotionPlanOffThread,
  isIdleCanvasMotionSuperseded,
  prepareIdleCanvasMotionPlanOffThread,
} from './idle-canvas-motion-worker-client';

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
  const printAndCut = useExperimentalLaserFeatures((state) => state.features.printAndCut);
  const firstRegistration = usePrintCutSessionStore((state) => state.first);
  const secondRegistration = usePrintCutSessionStore((state) => state.second);
  const showStartMarkers = useUiStore((state) => state.showCanvasStartMarkers);
  const canvasCovered = useCanvasViewStore((state) => state.showGcode);
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
    registrationKey,
    machineRevision,
    interactionActive,
    laser,
    canvasCovered,
  });

  const currentIdlePlan = idlePlan?.current === true ? idlePlan.plan : null;
  const staleTerminalRun = shouldClearTerminalRun(
    liveRun,
    currentIdlePlan,
    project.scene.objects.length === 0,
  );
  useClearStaleTerminalRun(liveRun, staleTerminalRun);

  if (previewMode || canvasCovered) return null;
  if (liveRun !== null && !staleTerminalRun) {
    return { plan: liveRun.plan, run: liveRun, showStartMarkers };
  }
  return idlePlan === null ? null : { plan: idlePlan.plan, run: null, showStartMarkers };
}

type IdlePlanInput = {
  readonly project: Project;
  readonly previewMode: boolean;
  readonly liveRun: LiveCanvasRun | null;
  readonly outputScope: OutputScope;
  readonly placementSettings: JobPlacementSettings;
  readonly placement: ResolvedJobPlacement;
  readonly registrationKey: string;
  readonly machineRevision: string;
  readonly interactionActive: boolean;
  readonly laser: ReturnType<typeof canvasMachineSnapshot>;
  readonly canvasCovered: boolean;
};

type IdlePlanState = {
  readonly plan: CanvasMotionPlan;
  readonly project: Project;
  readonly outputScope: OutputScope;
  readonly placementSettings: JobPlacementSettings;
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
    let workerStarted = false;
    const timer = window.setTimeout(() => {
      const buildRequest = idleCanvasMotionPlanRequest(requestInput, requestInput.placement);
      const requiresBackground =
        buildRequest.registration !== undefined ||
        hasVariableText(requestInput.project) ||
        costlyCanvasPreparation(requestInput.project, requestInput.outputScope);
      const offThread = requiresBackground
        ? prepareIdleCanvasMotionPlanOffThread(buildRequest)
        : null;
      if (requiresBackground && offThread === null) {
        // Never turn Worker unavailability into a multi-second browser-thread
        // V-carve compile merely to draw idle markers. Preview, Job Review,
        // Frame, Start, Save, and emitted output keep their own full paths.
        setIdleState(null);
        return;
      }
      workerStarted = offThread !== null;
      const pending = offThread ?? buildIdleCanvasMotionPlanFromRequest(buildRequest);
      void pending.then(
        (plan) => {
          if (cancelled || request !== requestRef.current) return;
          setIdleState(plan === null ? null : idlePlanState(plan, requestInput));
        },
        (error: unknown) => {
          if (cancelled || request !== requestRef.current) return;
          if (isIdleCanvasMotionSuperseded(error)) return;
          setIdleState(null);
        },
      );
    }, IDLE_CANVAS_PLAN_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (workerStarted) cancelIdleCanvasMotionPlanOffThread();
    };
  }, [
    input.previewMode,
    input.liveRun?.lifecycle,
    input.project,
    input.outputScope,
    input.placementSettings,
    input.placement,
    input.registrationKey,
    input.machineRevision,
    input.interactionActive,
    input.laser,
    input.canvasCovered,
  ]);
  if (shouldClearIdlePlan(input) || isActiveCanvasLifecycleOrNull(input.liveRun)) return null;
  if (idleState === null || !idleStateCanRemainVisible(idleState, input)) return null;
  return { plan: idleState.plan, current: idleStateMatches(idleState, input) };
}

function hasVariableText(project: Project): boolean {
  return project.scene.objects.some(
    (object) => object.kind === 'text' && object.variableTemplate !== undefined,
  );
}

export async function buildIdleCanvasMotionPlan(
  input: IdlePlanInput,
  resolved: ResolvedJobPlacement,
): Promise<CanvasMotionPlan | null> {
  return buildIdleCanvasMotionPlanFromRequest(idleCanvasMotionPlanRequest(input, resolved));
}

function idleCanvasMotionPlanRequest(
  input: IdlePlanInput,
  resolved: ResolvedJobPlacement,
): IdleCanvasMotionPlanRequest {
  const registration = currentPrintCutOutputRegistration(input.project);
  return {
    project: input.project,
    outputScope: input.outputScope,
    placementSettings: input.placementSettings,
    resolvedPlacement: resolved,
    ...(registration === undefined ? {} : { registration }),
    machine: input.laser,
    statusQuery: statusQueryFor(input.project, input.laser),
    reportInches: input.laser.controllerSettings?.reportInches === true,
  };
}

function shouldClearIdlePlan(input: IdlePlanInput): boolean {
  return input.previewMode || input.canvasCovered || input.project.scene.objects.length === 0;
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
    state.registrationKey === input.registrationKey &&
    state.machineRevision === input.machineRevision
  );
}

function shouldClearTerminalRun(
  liveRun: LiveCanvasRun | null,
  idlePlan: CanvasMotionPlan | null,
  projectIsEmpty: boolean,
): boolean {
  if (liveRun === null || isActiveCanvasLifecycle(liveRun)) return false;
  if (projectIsEmpty) return true;
  return idlePlan !== null && liveRun.plan.retentionKey !== idlePlan.retentionKey;
}

function useClearStaleTerminalRun(liveRun: LiveCanvasRun | null, stale: boolean): void {
  useEffect(() => {
    if (!stale || liveRun === null) return;
    if (useLaserStore.getState().liveCanvasRun !== liveRun) return;
    useLaserStore.setState({ liveCanvasRun: null });
  }, [liveRun, stale]);
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
