import type { StatusQueryCapability } from '../../core/controllers';
import { normalizeReportedMPosToMm } from '../../core/controllers/grbl/machine-envelope';
import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import {
  buildToolpath,
  computeJobBounds,
  rotaryAppliesTo,
  type JobOriginPlacement,
  type JobPlacementSettings,
} from '../../core/job';
import {
  buildMotionManifest,
  type MotionManifest,
  type MotionPoint,
} from '../../core/job/motion-manifest';
import {
  INITIAL_ROUTE_RECONCILIATION,
  type RouteReconciliationState,
} from '../../core/job/live-route-reconciliation';
import { fingerprintGcode, type GcodeFingerprint } from '../../core/recovery';
import {
  machineKindOf,
  type MachineKind,
  type OutputScope,
  type Project,
  type Vec2,
} from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import type { MachineStartSnapshot } from '../laser/start-job-readiness';

export type CanvasPlanCapability = 'realtime' | 'settle-only' | 'file-only' | 'unavailable';

export type CanvasMotionPlan = {
  readonly manifest: MotionManifest;
  readonly fingerprint: GcodeFingerprint;
  readonly retentionKey: string;
  readonly machineKind: MachineKind;
  readonly device: DeviceProfile;
  readonly coordinateFrame:
    | { readonly kind: 'machine'; readonly workOffsetMm: MotionPoint }
    | { readonly kind: 'relative'; readonly jobOriginOffset: Vec2 };
  readonly framePerimeter: ReadonlyArray<Vec2>;
  readonly jobStart: Vec2 | null;
  readonly approachFrom: Vec2 | null;
  readonly capability: CanvasPlanCapability;
  readonly unavailableReason: string | null;
  readonly resumed: boolean;
  readonly positionEpoch: number;
};

export type LiveCanvasLifecycle =
  | 'running'
  | 'paused'
  | 'tool-change'
  | 'stopped'
  | 'disconnected'
  | 'errored'
  | 'finished';

export type LiveCanvasRun = {
  readonly plan: CanvasMotionPlan;
  readonly reportedHead: MotionPoint | null;
  readonly route: RouteReconciliationState;
  readonly lifecycle: LiveCanvasLifecycle;
  readonly controllerState: string | null;
  readonly accuracyReason: string | null;
};

export function buildCanvasMotionPlan(args: {
  readonly gcode: string;
  readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
  readonly machine: MachineStartSnapshot;
  readonly statusQuery?: StatusQueryCapability;
  readonly reportInches?: boolean;
  readonly jobOrigin?: JobOriginPlacement;
  readonly relativeView?: boolean;
  readonly retentionKey?: string;
  readonly resumed?: boolean;
}): CanvasMotionPlan {
  const machineKind = machineKindOf(args.prepared.project.machine);
  const initial = reportedWorkPositionMm(args.machine, args.reportInches === true);
  const manifest = buildMotionManifest(args.gcode, {
    machineKind,
    ...(initial === null ? {} : { initialPosition: initial }),
  });
  const coordinateFrame = canvasCoordinateFrame(
    args.prepared,
    args.machine,
    args.reportInches === true,
    args.jobOrigin,
    args.relativeView === true,
  );
  const rotary = rotaryAppliesTo(args.prepared.project.device, args.prepared.project.machine);
  const capability = canvasCapability(args.statusQuery ?? 'realtime-report', rotary);
  const map = (point: MotionPoint): Vec2 =>
    mapControllerPointToScene(point, {
      device: args.prepared.project.device,
      coordinateFrame,
    });
  const bounds = computeJobBounds(args.prepared.job, args.prepared.project.device);
  const frameController =
    bounds === null
      ? []
      : [
          { x: bounds.minX, y: bounds.minY, z: 0 },
          { x: bounds.maxX, y: bounds.minY, z: 0 },
          { x: bounds.maxX, y: bounds.maxY, z: 0 },
          { x: bounds.minX, y: bounds.maxY, z: 0 },
          { x: bounds.minX, y: bounds.minY, z: 0 },
        ];
  const surfaceStart = rotary ? firstSurfaceProcessPoint(args.prepared) : null;
  const controllerStart = manifest.firstProcessPoint;
  const jobStart =
    surfaceStart === null
      ? controllerStart === null
        ? null
        : map(controllerStart)
      : mapRelativeSurfacePoint(surfaceStart, args.prepared);
  return {
    manifest,
    fingerprint: fingerprintGcode(args.gcode),
    retentionKey: args.retentionKey ?? JSON.stringify(fingerprintGcode(args.gcode)),
    machineKind,
    device: args.prepared.project.device,
    coordinateFrame,
    framePerimeter: capability === 'file-only' ? [] : frameController.map(map),
    jobStart,
    approachFrom: rotary || initial === null ? null : map(initial),
    capability,
    unavailableReason: capabilityReason(capability, rotary),
    resumed: args.resumed === true,
    positionEpoch: args.machine.trustedPositionEpoch ?? 0,
  };
}

export function canvasPlanRetentionKey(
  project: Project,
  outputScope: OutputScope,
  placement: JobPlacementSettings,
  registration?: unknown,
): string {
  const serialized = JSON.stringify({
    scene: project.scene,
    machine: project.machine,
    device: project.device,
    optimization: project.optimization,
    variables: project.variables,
    outputScope,
    placement,
    ...(registration === undefined ? {} : { registration }),
  });
  const fingerprint = fingerprintGcode(serialized);
  return `${fingerprint.fnv1a}:${fingerprint.chars}:${fingerprint.lines}`;
}

export function startLiveCanvasRun(plan: CanvasMotionPlan): LiveCanvasRun {
  return {
    plan,
    reportedHead: null,
    route: INITIAL_ROUTE_RECONCILIATION,
    lifecycle: 'running',
    controllerState: null,
    accuracyReason: plan.unavailableReason,
  };
}

export function rebuildCanvasPlanForGcode(
  plan: CanvasMotionPlan,
  gcode: string,
  initialPosition?: MotionPoint,
): CanvasMotionPlan {
  const manifest = buildMotionManifest(gcode, {
    machineKind: plan.machineKind,
    ...(initialPosition === undefined ? {} : { initialPosition }),
  });
  const jobStart =
    manifest.firstProcessPoint === null
      ? null
      : mapControllerPointToScene(manifest.firstProcessPoint, plan);
  return {
    ...plan,
    manifest,
    fingerprint: fingerprintGcode(gcode),
    jobStart,
    approachFrom:
      initialPosition === undefined || plan.capability === 'unavailable'
        ? null
        : mapControllerPointToScene(initialPosition, plan),
    resumed: true,
  };
}

export function mapControllerPointToScene(
  point: MotionPoint,
  plan: Pick<CanvasMotionPlan, 'device' | 'coordinateFrame'>,
): Vec2 {
  const frame = plan.coordinateFrame;
  if (frame.kind === 'relative') {
    return toSceneCoords(
      { x: point.x - frame.jobOriginOffset.x, y: point.y - frame.jobOriginOffset.y },
      plan.device,
    );
  }
  return toSceneCoords(
    { x: point.x + frame.workOffsetMm.x, y: point.y + frame.workOffsetMm.y },
    plan.device,
  );
}

export function reportedWorkPositionMm(
  machine: Pick<MachineStartSnapshot, 'statusReport' | 'wcoCache' | 'workOriginActive'>,
  reportInches: boolean,
): MotionPoint | null {
  const report = machine.statusReport;
  if (report === null) return null;
  if (report.wPos !== null) return normalized(report.wPos, reportInches);
  if (report.mPos === null) return null;
  const mPos = normalized(report.mPos, reportInches);
  const wcoRaw = machine.wcoCache ?? report.wco;
  if (wcoRaw === null && machine.workOriginActive === true) return null;
  const wco = wcoRaw === null ? { x: 0, y: 0, z: 0 } : normalized(wcoRaw, reportInches);
  return { x: mPos.x - wco.x, y: mPos.y - wco.y, z: mPos.z - wco.z };
}

function canvasCoordinateFrame(
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
  machine: MachineStartSnapshot,
  reportInches: boolean,
  jobOrigin: JobOriginPlacement | undefined,
  relativeView: boolean,
): CanvasMotionPlan['coordinateFrame'] {
  // A missing physical WCO is exactly the Verified-Origin contract: retain a
  // truthful artwork-relative view and label that the bed position is unknown.
  const wcoRaw = machine.wcoCache ?? machine.statusReport?.wco ?? null;
  if (
    relativeView ||
    jobOrigin?.startFrom === 'verified-origin' ||
    (machine.workOriginActive === true && wcoRaw === null)
  ) {
    return { kind: 'relative', jobOriginOffset: prepared.jobOriginOffset };
  }
  const workOffsetMm = wcoRaw === null ? { x: 0, y: 0, z: 0 } : normalized(wcoRaw, reportInches);
  return { kind: 'machine', workOffsetMm };
}

function normalized(point: MotionPoint, reportInches: boolean): MotionPoint {
  const [x, y, z] = normalizeReportedMPosToMm([point.x, point.y, point.z], reportInches);
  return { x, y, z };
}

function canvasCapability(
  statusQuery: StatusQueryCapability,
  rotary: boolean,
): CanvasPlanCapability {
  if (rotary) return 'unavailable';
  if (statusQuery === 'realtime-report') return 'realtime';
  if (statusQuery === 'queued-poll') return 'settle-only';
  return 'file-only';
}

function capabilityReason(capability: CanvasPlanCapability, rotary: boolean): string | null {
  if (rotary) return 'Live trail unavailable for rotary jobs; start markers are surface-relative.';
  if (capability === 'settle-only')
    return 'Live position unavailable; route confirms after motion settles.';
  if (capability === 'file-only') return 'Live position unavailable for file-only controllers.';
  return null;
}

function firstSurfaceProcessPoint(
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
): Vec2 | null {
  const toolpath = buildToolpath(prepared.job);
  const step = toolpath.steps.find((candidate) => candidate.kind === 'cut');
  return step?.kind === 'cut' ? (step.polyline[0] ?? null) : null;
}

function mapRelativeSurfacePoint(
  point: Vec2,
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
): Vec2 {
  return toSceneCoords(
    {
      x: point.x - prepared.jobOriginOffset.x,
      y: point.y - prepared.jobOriginOffset.y,
    },
    prepared.project.device,
  );
}
