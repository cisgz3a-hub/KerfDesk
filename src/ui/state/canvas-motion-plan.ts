import type { StatusQueryCapability } from '../../core/controllers';
import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import { laserPowerControlForDevice } from '../../core/gcode-view';
import {
  rotaryAppliesTo,
  type JobOriginPlacement,
  type JobPlacementSettings,
} from '../../core/job';
import { firstSurfaceProcessPoint } from './canvas-first-process-point';
import { orderedRetentionValue } from './canvas-retention-json';
import {
  buildMotionManifest,
  type MotionManifest,
  type MotionPoint,
} from '../../core/job/motion-manifest';
import {
  INITIAL_ROUTE_RECONCILIATION,
  type RouteReconciliationState,
} from '../../core/job/live-route-reconciliation';
import { finishOptionsForJob } from '../../core/output/output-strategy';
import { fingerprintGcode, type GcodeFingerprint } from '../../core/recovery';
import {
  machineKindOf,
  type MachineKind,
  type OutputScope,
  type Project,
  type Vec2,
} from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { buildExecutablePlanSidecar } from '../../io/gcode/executable-plan';
import type { MachineStartSnapshot } from '../laser/start-job-readiness';
import { cncPassRouteSpans, type CncPassRouteSpan } from './canvas-pass-progress';
import { registerCanvasExecutablePlan } from './canvas-preview-motion';
import { registerCanvasProgramSource } from './canvas-program-source';
import { canvasExecutableSidecarWithinBudget } from './canvas-program-analysis-budget';
import type { LiveJobTiming } from './live-job-timing';
import {
  canvasCoordinateFrame,
  mapControllerPointToScene,
  normalizedReportPoint,
  type CanvasCoordinateFrame,
} from './canvas-coordinate-frame';
import { framePerimeterForCanvas } from './canvas-frame-perimeter';
import {
  buildCanvasStartEditingData,
  type CanvasStartEditingData,
} from './canvas-start-editing-data';

export {
  artworkToBedShift,
  canvasCoordinateFrame,
  mapControllerPointToScene,
} from './canvas-coordinate-frame';

export type CanvasPlanCapability = 'realtime' | 'settle-only' | 'file-only' | 'unavailable';

export type CanvasMotionPlan = {
  readonly manifest: MotionManifest;
  readonly fingerprint: GcodeFingerprint;
  readonly retentionKey: string;
  readonly machineKind: MachineKind;
  readonly device: DeviceProfile;
  readonly coordinateFrame: CanvasCoordinateFrame;
  readonly framePerimeter: ReadonlyArray<Vec2>;
  readonly startEditingData?: CanvasStartEditingData;
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
  /** Last controller-reported spindle speed from `FS:`, or null when absent.
   * Meaningful as RPM only for CNC; on a laser this field is the power S value
   * (ADR-220), so only the CNC badge surfaces it. */
  readonly reportedSpindleRpm: number | null;
  /** Wall-clock epoch ms when this run started streaming, or 0 when unknown
   * (hand-built fixtures). The badge shows elapsed time only for a real
   * stamp (ADR-221). */
  readonly startedAtMs: number;
  /** Wall-clock epoch ms of the first terminal lifecycle transition
   * (stopped/disconnected/errored/finished), freezing the elapsed readout;
   * null while the run can still advance. */
  readonly endedAtMs: number | null;
  readonly timing?: LiveJobTiming;
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
  readonly includeStartPointBounds?: boolean;
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
    laserPowerControl: laserPowerControlForDevice(args.prepared.project.device),
    ...(initial === null ? {} : { initialPosition: initial }),
  });
  const plan = assembleCanvasPlan(args, manifest, manifest.firstProcessPoint, initial, args.gcode);
  registerCanvasProgramSource(plan, args.gcode);
  if (
    (plan.capability === 'realtime' || plan.capability === 'settle-only') &&
    canvasExecutableSidecarWithinBudget(args.gcode, manifest)
  ) {
    const sidecar = buildExecutablePlanSidecar(args.gcode, args.prepared.project);
    if (sidecar.kind === 'ok') registerCanvasExecutablePlan(plan, sidecar.plan);
  }
  return plan;
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
    framePerimeter: capability === 'file-only' ? [] : framePerimeterForCanvas(args.prepared, map),
    startEditingData: buildCanvasStartEditingData(args.prepared, args.includeStartPointBounds),
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
    finishOptionsForJob(args.prepared.job, args.jobOrigin),
  );
  return spans === undefined ? {} : { cncPassSpans: spans };
}

const DESCRIPTIVE_DEVICE_FIELDS: ReadonlySet<keyof DeviceProfile> = new Set([
  'name',
  'vendor',
  'model',
  'profileSource',
  'catalogVersion',
  'evidence',
  // Saved head positions (ADR-493) are only read by the Move to position panel;
  // saving one after Frame must not expire a permit whose program is unchanged.
  'savedPositions',
]);

function retainedDeviceFields(device: DeviceProfile): Readonly<Record<string, unknown>> {
  // Exclude only descriptive labels. Timing calibration, no-go warnings and
  // every other (including future) field still bind the cached artifact.
  return Object.fromEntries(
    Object.entries(device).filter(
      ([key]) => !DESCRIPTIVE_DEVICE_FIELDS.has(key as keyof DeviceProfile),
    ),
  );
}

// Selection only shapes the program while "Selected artwork only" is on; with it
// off, validateOutputScope returns the scene untouched for any selection, so the
// ids must not perturb the retention key. That key is also the Frame permit's
// execution signature, and a bare canvas click after Frame was expiring the
// permit with "output selection changed" (ADR-327).
function executionOutputScope(scope: OutputScope): OutputScope {
  return scope.cutSelectedGraphics || scope.selectedObjectIds.length === 0
    ? scope
    : { ...scope, selectedObjectIds: [] };
}

export function canvasPlanRetentionKey(
  project: Project,
  outputScope: OutputScope,
  placement: JobPlacementSettings,
  registration?: unknown,
): string {
  const scope = executionOutputScope(outputScope);
  const optionsKey = JSON.stringify({
    outputScope: scope,
    placement,
    hasRegistration: registration !== undefined,
    registration: registration ?? null,
  });
  const cached = retentionKeyCache.get(project)?.get(optionsKey);
  if (cached !== undefined) return cached;
  const serialized = JSON.stringify(
    orderedRetentionValue({
      scene: project.scene,
      machine: project.machine,
      cncSetup: project.cncSetup,
      device: retainedDeviceFields(project.device),
      optimization: project.optimization,
      startPoints: project.startPoints,
      variables: project.variables,
      outputScope: scope,
      placement,
      ...(registration === undefined ? {} : { registration }),
    }),
  );
  const fingerprint = fingerprintGcode(serialized);
  const key = `${fingerprint.fnv1a}:${fingerprint.chars}:${fingerprint.lines}`;
  const byOptions = retentionKeyCache.get(project) ?? new Map<string, string>();
  byOptions.set(optionsKey, key);
  retentionKeyCache.set(project, byOptions);
  return key;
}

export function startLiveCanvasRun(plan: CanvasMotionPlan, startedAtMs = 0): LiveCanvasRun {
  return {
    plan,
    reportedHead: null,
    route: INITIAL_ROUTE_RECONCILIATION,
    lifecycle: 'running',
    controllerState: null,
    accuracyReason: plan.unavailableReason,
    reportedFeedMmPerMin: null,
    reportedSpindleRpm: null,
    startedAtMs,
    endedAtMs: null,
  };
}

export function rebuildCanvasPlanForGcode(
  plan: CanvasMotionPlan,
  gcode: string,
  initialPosition?: MotionPoint,
): CanvasMotionPlan {
  const manifest = buildMotionManifest(gcode, {
    machineKind: plan.machineKind,
    laserPowerControl: laserPowerControlForDevice(plan.device),
    ...(initialPosition === undefined ? {} : { initialPosition }),
  });
  const jobStart =
    manifest.firstProcessPoint === null
      ? null
      : mapControllerPointToScene(manifest.firstProcessPoint, plan);
  // A resume program renumbers every line, so the original run's pass spans
  // no longer describe it. Dropping them beats displaying a wrong pass.
  const { cncPassSpans: _stale, ...base } = plan;
  const resumedPlan: CanvasMotionPlan = {
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
  registerCanvasProgramSource(resumedPlan, gcode);
  return resumedPlan;
}

export function reportedWorkPositionMm(
  machine: Pick<MachineStartSnapshot, 'statusReport' | 'wcoCache' | 'workOriginActive'>,
  reportInches: boolean,
): MotionPoint | null {
  const report = machine.statusReport;
  if (report === null) return null;
  if (report.wPos !== null) return normalizedReportPoint(report.wPos, reportInches);
  if (report.mPos === null) return null;
  const mPos = normalizedReportPoint(report.mPos, reportInches);
  // WCO belongs to the same controller sample as MPos, so prefer it over the
  // intermittent cache. Mixing a fresh MPos with an older cached WCO can move
  // the canvas head by the entire work offset for a single frame.
  const wcoRaw = report.wco ?? machine.wcoCache ?? null;
  if (wcoRaw === null && machine.workOriginActive === true) return null;
  const wco = wcoRaw === null ? { x: 0, y: 0, z: 0 } : normalizedReportPoint(wcoRaw, reportInches);
  return { x: mPos.x - wco.x, y: mPos.y - wco.y, z: mPos.z - wco.z };
}

export function canvasCapability(
  statusQuery: StatusQueryCapability,
  rotary: boolean,
): CanvasPlanCapability {
  if (rotary) return 'unavailable';
  if (statusQuery === 'realtime-report') return 'realtime';
  if (statusQuery === 'queued-poll') return 'settle-only';
  return 'file-only';
}

export function capabilityReason(capability: CanvasPlanCapability, rotary: boolean): string | null {
  if (rotary) return 'Live trail unavailable for rotary jobs; start markers are surface-relative.';
  if (capability === 'settle-only')
    return 'Live position unavailable; route confirms after motion settles.';
  if (capability === 'file-only') return 'Live position unavailable for file-only controllers.';
  return null;
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
