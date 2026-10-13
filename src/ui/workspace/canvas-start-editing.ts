import { toMachineCoords, toSceneCoords } from '../../core/devices';
import { rotaryAppliesTo, type JobBounds } from '../../core/job';
import { buildFramePerimeter, nearestFrameStartPoint } from '../../core/job/frame-perimeter';
import { jobStartPointOptions, resolveJobStartPoint } from '../../core/job/job-start-point';
import { computeJobStartBounds } from '../../core/job/job-start-bounds';
import type { Project, Vec2 } from '../../core/scene';
import type { ProjectStartPoints } from '../../core/scene/start-points';
import type { PreparedOutput } from '../../io/gcode';
import { mapControllerPointToScene, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import { currentPrintCutOutputRegistration } from '../laser/print-cut-output';
import { loadCanvasStartBounds } from '../state/canvas-start-bounds-loader';

type Prepared = Extract<PreparedOutput, { readonly ok: true }>;
export type StartEditingContext = {
  readonly prepared: Prepared;
  readonly sourceProject: Project;
  readonly registered: boolean;
  readonly bounds?: JobBounds | null;
  readonly jobReason?: string | null;
  readonly loadBounds?: () => Promise<JobBounds | null>;
};
const contexts = new WeakMap<CanvasMotionPlan, StartEditingContext>();
const jobEditReasons = new WeakMap<StartEditingContext, string | null>();

export function registerStartEditing(plan: CanvasMotionPlan, context: StartEditingContext): void {
  contexts.set(plan, context);
}

export function startEditingContext(
  plan: CanvasMotionPlan,
  project?: Project,
): StartEditingContext | undefined {
  const cached = contexts.get(plan);
  if (project === undefined || cached?.sourceProject === project) return cached;
  const data = plan.startEditingData;
  if (data === undefined) return undefined;
  const context: StartEditingContext = {
    sourceProject: project,
    prepared: { ok: true, project, job: data.job, jobOriginOffset: data.jobOriginOffset },
    ...(data.bounds === undefined ? {} : { bounds: data.bounds }),
    loadBounds: () => loadCanvasStartBounds(plan),
    jobReason: data.jobReason,
    registered: currentPrintCutOutputRegistration(project) != null,
  };
  contexts.set(plan, context);
  return context;
}

export type StartKind = 'frame' | 'job';
export type StartSelection = { readonly point: Vec2; readonly settings: ProjectStartPoints };

export function startEditReason(kind: StartKind, context: StartEditingContext): string | null {
  const { sourceProject } = context;
  if (context.registered)
    return 'Start editing is unavailable while Print and Cut registration is active.';
  if (rotaryAppliesTo(sourceProject.device, sourceProject.machine)) {
    return 'Start editing is unavailable in the rotary surface view.';
  }
  if (kind === 'frame') return null;
  if (isSideBJobSelection(kind, sourceProject)) {
    return 'Side B keeps the cutting start selected on the source artwork.';
  }
  return jobEditReason(context);
}

function jobEditReason(context: StartEditingContext): string | null {
  const { prepared, sourceProject } = context;
  if (context.jobReason !== undefined) return context.jobReason;
  if (jobEditReasons.has(context)) return jobEditReasons.get(context) ?? null;
  const first = resolveJobStartPoint(
    prepared.job,
    { x: 0, y: 0 },
    jobStartPointOptions(
      sourceProject.optimization,
      sourceProject.device.scanningOffsets,
      prepared.project.device,
    ),
  );
  const reason =
    first?.supported === true
      ? null
      : (first?.reason ?? 'This operation has no movable cutting start.');
  jobEditReasons.set(context, reason);
  return reason;
}

export function selectCanvasStart(
  kind: StartKind,
  point: Vec2,
  plan: CanvasMotionPlan,
  context: StartEditingContext,
): StartSelection | null {
  if (
    startEditReason('frame', context) !== null ||
    isSideBJobSelection(kind, context.sourceProject)
  )
    return null;
  const target = sceneToController(point, plan);
  const settings = context.sourceProject.startPoints ?? {};
  if (kind === 'frame') {
    const bounds = controllerFrameBounds(plan);
    if (bounds === null) return null;
    const frame = nearestFrameStartPoint(bounds, target);
    const start = buildFramePerimeter(bounds, frame)[0];
    return start === undefined
      ? null
      : {
          point: mapControllerPointToScene({ ...start, z: 0 }, plan),
          settings: { ...settings, frame },
        };
  }
  const selected = resolveJobStartPoint(
    context.prepared.job,
    target,
    jobStartPointOptions(
      context.sourceProject.optimization,
      context.sourceProject.device.scanningOffsets,
      plan.device,
    ),
  );
  if (selected?.supported !== true) return null;
  const offset = context.prepared.jobOriginOffset;
  const job = toSceneCoords(
    { x: selected.point.x - offset.x, y: selected.point.y - offset.y },
    plan.device,
  );
  return {
    point: mapControllerPointToScene({ ...selected.point, z: 0 }, plan),
    settings: { ...settings, job },
  };
}

function isSideBJobSelection(kind: StartKind, project: Project): boolean {
  return (
    kind === 'job' &&
    project.machine?.kind === 'cnc' &&
    project.cncSetup?.twoSided?.activeSide === 'B'
  );
}

function sceneToController(point: Vec2, plan: CanvasMotionPlan): Vec2 {
  const machine = toMachineCoords(point, plan.device);
  const frame = plan.coordinateFrame;
  return frame.kind === 'relative'
    ? { x: machine.x + frame.jobOriginOffset.x, y: machine.y + frame.jobOriginOffset.y }
    : {
        x: machine.x - frame.workOffsetMm.x - (frame.nativeToBedOffsetMm?.x ?? 0),
        y: machine.y - frame.workOffsetMm.y - (frame.nativeToBedOffsetMm?.y ?? 0),
      };
}

function controllerFrameBounds(plan: CanvasMotionPlan) {
  if (plan.framePerimeter.length < 2) return null;
  const points = plan.framePerimeter.map((point) => sceneToController(point, plan));
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

/** Save a relative preference for future artwork, never an old artwork's coordinates. */
export async function reusableStartPoints(
  context: StartEditingContext,
): Promise<ProjectStartPoints> {
  const settings = context.sourceProject.startPoints ?? {};
  const job = settings.job;
  if (job === undefined || job.relative === true) return settings;
  const bounds =
    context.bounds === undefined
      ? context.loadBounds === undefined
        ? computeJobStartBounds(context.prepared.job, context.prepared.project.device)
        : await context.loadBounds()
      : context.bounds;
  if (bounds === null) return settings.frame === undefined ? {} : { frame: settings.frame };
  const offset = context.prepared.jobOriginOffset;
  const a = toSceneCoords(
    { x: bounds.minX - offset.x, y: bounds.minY - offset.y },
    context.prepared.project.device,
  );
  const b = toSceneCoords(
    { x: bounds.maxX - offset.x, y: bounds.maxY - offset.y },
    context.prepared.project.device,
  );
  return {
    ...settings,
    job: {
      x: fraction(job.x, a.x, b.x),
      y: fraction(job.y, a.y, b.y),
      relative: true,
    },
  };
}

function fraction(value: number, a: number, b: number): number {
  return a === b ? 0.5 : Math.max(0, Math.min(1, (value - Math.min(a, b)) / Math.abs(b - a)));
}
