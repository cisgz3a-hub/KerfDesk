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
import { finishOptionsForJobOrigin } from '../../core/output';
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
import { cncPassRouteSpans, type CncPassRouteSpan } from './canvas-pass-progress';

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
  /** CNC only: each depth pass's route range (ADR-216). Absent whenever the
   * started program is not the plain strategy emission of the prepared job. */
  readonly cncPassSpans?: ReadonlyArray<CncPassRouteSpan>;
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
  /** Last controller-reported feed rate normalized to mm/min, or null when the
   * status frame carried no `FS:`/`F:` sample (ADR-217). */
  readonly reportedFeedMmPerMin: number | null;
};

const retentionKeyCache = new WeakMap<Project, Map<string, string>>();

const EMPTY_MOTION_MANIFEST: MotionManifest = {
  blocks: [],
  totalRouteMm: 0,
  sendableLineCount: 0,
  firstProcessPoint: null,
  finalPoint: null,
};

type CanvasPlanBuildContext = {
  readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
  readonly machine: MachineStartSnapshot;
  readonly statusQuery?: StatusQueryCapability;
  readonly reportInches?: boolean;
  readonly jobOrigin?: JobOriginPlacement;
  readonly relativeView?: boolean;
  readonly retentionKey?: string;
  readonly resumed?: boolean;
};

export function buildCanvasMotionPlan(
  args: CanvasPlanBuildContext & {
    readonly gcode: string;
  },
): CanvasMotionPlan {
  const machineKind = machineKindOf(args.prepared.project.machine);
  const initial = reportedWorkPositionMm(args.machine, args.reportInches === true);
  const manifest = buildMotionManifest(args.gcode, {
    machineKind,
    ...(initial === null ? {} : { initialPosition: initial }),
  });
  return assembleCanvasPlan(args, manifest, manifest.firstProcessPoint, initial, args.gcode);
}

export function buildCanvasMarkerPlan(args: CanvasPlanBuildContext): CanvasMotionPlan {
  const initial = reportedWorkPositionMm(args.machine, args.reportInches === true);
  const firstProcess = firstSurfaceProcessPoint(args.prepared);
  const controllerStart =
    firstProcess === null ? null : { x: firstProcess.x, y: firstProcess.y, z: 0 };
  return assembleCanvasPlan(args, EMPTY_MOTION_MANIFEST, controllerStart, initial, '');
}

function assembleCanvasPlan(
  args: CanvasPlanBuildContext,
  manifest: MotionManifest,
  controllerStart: MotionPoint | null,
  initial: MotionPoint | null,
  fingerprintSource: string,
): CanvasMotionPlan {
  const machineKind = machineKindOf(args.prepared.project.machine);
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
  const jobStart =
    surfaceStart === null
      ? controllerStart === null
        ? null
        : map(controllerStart)
      : mapRelativeSurfacePoint(surfaceStart, args.prepared);
  return {
    ...cncPassSpansOption(args, machineKind, manifest, fingerprintSource),
    manifest,
    fingerprint: fingerprintGcode(fingerprintSource),
    retentionKey: args.retentionKey ?? JSON.stringify(fingerprintGcode(fingerprintSource)),
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

// Marker plans pass an empty program; only a real started program can be
// byte-checked against the sidecar re-emission (ADR-216). The re-emission
// carries the run's own finish options — a current-position start parks at
// its own start (#226), and dropping that option would fail the byte check
// and silently omit the pass display for every such job.
function cncPassSpansOption(
  args: CanvasPlanBuildContext,
  machineKind: MachineKind,
  manifest: MotionManifest,
  fingerprintSource: string,
): { readonly cncPassSpans?: ReadonlyArray<CncPassRouteSpan> } {
  if (machineKind !== 'cnc' || fingerprintSource === '') return {};
  const spans = cncPassRouteSpans(
    args.prepared.job,
    args.prepared.project.device,
    fingerprintSource,
    manifest,
    finishOptionsForJobOrigin(args.jobOrigin),
  );
  return spans === undefined ? {} : { cncPassSpans: spans };
}

export function canvasPlanRetentionKey(
  project: Project,
  outputScope: OutputScope,
  placement: JobPlacementSettings,
  registration?: unknown,
): string {
  const optionsKey = JSON.stringify({
    outputScope,
    placement,
    hasRegistration: registration !== undefined,
    registration: registration ?? null,
  });
  const cached = retentionKeyCache.get(project)?.get(optionsKey);
  if (cached !== undefined) return cached;
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
  const key = `${fingerprint.fnv1a}:${fingerprint.chars}:${fingerprint.lines}`;
  const byOptions = retentionKeyCache.get(project) ?? new Map<string, string>();
  byOptions.set(optionsKey, key);
  retentionKeyCache.set(project, byOptions);
  return key;
}

export function startLiveCanvasRun(plan: CanvasMotionPlan): LiveCanvasRun {
  return {
    plan,
    reportedHead: null,
    route: INITIAL_ROUTE_RECONCILIATION,
    lifecycle: 'running',
    controllerState: null,
    accuracyReason: plan.unavailableReason,
    reportedFeedMmPerMin: null,
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
  // A resume program renumbers every line, so the original run's pass spans
  // no longer describe it. Dropping them beats displaying a wrong pass.
  const { cncPassSpans: _stale, ...base } = plan;
  return {
    ...base,
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
  // WCO belongs to the same controller sample as MPos, so prefer it over the
  // intermittent cache. Mixing a fresh MPos with an older cached WCO can move
  // the canvas head by the entire work offset for a single frame.
  const wcoRaw = report.wco ?? machine.wcoCache ?? null;
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
  const wcoRaw = machine.statusReport?.wco ?? machine.wcoCache ?? null;
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
  const toolpath = buildToolpath(prepared.job, {
    scanningOffsets: prepared.project.device.scanningOffsets,
  });
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
