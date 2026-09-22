import { rotaryAppliesTo } from '../../core/job';
import { reportedWorkPositionMm, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import type { ExecutionArtifactV1 } from '../state/recovery';
import {
  isPackedMotionManifest,
  packMotionManifest,
  type PackedMotionManifest,
} from '../state/recovery/packed-motion-manifest';
import {
  packRecoveryPreviewManifest,
  type LaserRecoveryPreviewReply,
  type LaserRecoveryPreviewRequest,
} from './laser-recovery-preview-protocol';

export type RecoveryPreviewMapping = Pick<CanvasMotionPlan, 'device' | 'coordinateFrame'>;

/** A saved route in columnar form. The restart picker culls, draws and
 * hit-tests it without materialising one object per sampled point. */
export type RecoveryPreviewRoute = RecoveryPreviewMapping & {
  readonly manifest: PackedMotionManifest;
  readonly capability: 'file-only' | 'unavailable';
  readonly unavailableReason: string | null;
};

export type RecoveryPreviewSource = LaserRecoveryPreviewRequest & {
  readonly mapping: RecoveryPreviewMapping;
  readonly rotary: boolean;
};

const ROTARY_UNAVAILABLE = 'A positioned restart preview is unavailable for rotary jobs.';

/** Called with an artifact verified by the recovery repository. Persisted canvas
 * coordinates are diagnostic data, not part of its cryptographic envelope.
 * Selectable movements come only from its sealed G-code, profile and historical
 * position observation, never from the stored plain or packed canvas manifest.
 * Archived observations position this preview only; they never qualify Start. */
export function laserRecoveryPreviewSource(artifact: ExecutionArtifactV1): RecoveryPreviewSource {
  const observation = artifact.archivedControllerObservation;
  const reportInches = observation.settings?.reportInches === true;
  const initialPosition = reportedWorkPositionMm(
    { statusReport: observation.statusReport ?? null, wcoCache: observation.wco ?? null },
    reportInches,
  );
  const device = artifact.prepared.project.device;
  return {
    gcode: artifact.gcode,
    initialPosition,
    mapping: {
      device,
      // Historical WCO is a native offset, not proof of where the bed lies.
      coordinateFrame: { kind: 'relative', jobOriginOffset: artifact.prepared.jobOriginOffset },
    },
    rotary: rotaryAppliesTo(device, undefined),
  };
}

export function laserRecoveryPreviewMapping(artifact: ExecutionArtifactV1): RecoveryPreviewMapping {
  return laserRecoveryPreviewSource(artifact).mapping;
}

function routeFromSource(
  source: RecoveryPreviewSource,
  manifest: PackedMotionManifest,
): RecoveryPreviewRoute {
  return {
    ...source.mapping,
    manifest,
    capability: source.rotary ? 'unavailable' : 'file-only',
    unavailableReason: source.rotary ? ROTARY_UNAVAILABLE : null,
  };
}

/** Synchronous derivation on the calling thread, for environments without
 * workers and for tests. The interactive path prefers the worker below. */
export function buildLaserRecoveryPreviewRoute(
  artifact: ExecutionArtifactV1,
): RecoveryPreviewRoute {
  const source = laserRecoveryPreviewSource(artifact);
  return routeFromSource(source, packRecoveryPreviewManifest(source));
}

/** A manual restart already owns a freshly prepared plan; pack it in place.
 * Marker-only legacy plans have no optional preview geometry and yield null. */
export function recoveryRouteFromCanvasPlan(plan: CanvasMotionPlan): RecoveryPreviewRoute | null {
  const manifest: CanvasMotionPlan['manifest'] | undefined = plan.manifest;
  if (
    !Array.isArray(manifest?.blocks) ||
    plan.device === undefined ||
    plan.coordinateFrame === undefined
  ) {
    return null;
  }
  try {
    const unavailable = plan.capability === 'unavailable';
    return {
      device: plan.device,
      coordinateFrame: plan.coordinateFrame,
      manifest: packMotionManifest(manifest, { enforceArchiveBudget: false }),
      capability: unavailable ? 'unavailable' : 'file-only',
      unavailableReason: unavailable ? plan.unavailableReason : null,
    };
  } catch {
    return null;
  }
}

type PreviewWorkerFactory = () => Worker | null;

let workerFactoryOverride: PreviewWorkerFactory | null | undefined;
let pendingRoutes = new WeakMap<ExecutionArtifactV1, Promise<RecoveryPreviewRoute>>();
let readyRoutes = new WeakMap<ExecutionArtifactV1, RecoveryPreviewRoute>();

function defaultWorkerFactory(): Worker {
  return new Worker(new URL('./laser-recovery-preview-worker.ts', import.meta.url), {
    type: 'module',
  });
}

function activeWorkerFactory(): PreviewWorkerFactory | null {
  if (workerFactoryOverride !== undefined) return workerFactoryOverride;
  return typeof Worker === 'function' ? defaultWorkerFactory : null;
}

/** Tests inject a fake worker (or `null` to force the synchronous path). Passing
 * `undefined` restores the default and forgets every cached route. */
export function configureLaserRecoveryPreviewWorkerForTests(
  factory: PreviewWorkerFactory | null | undefined,
): void {
  workerFactoryOverride = factory;
  pendingRoutes = new WeakMap();
  readyRoutes = new WeakMap();
}

export function peekLaserRecoveryPreviewRoute(
  artifact: ExecutionArtifactV1,
): RecoveryPreviewRoute | null {
  return readyRoutes.get(artifact) ?? null;
}

/** Without a worker the route is derived immediately on this thread, which is
 * the pre-worker behaviour. With one available this returns null and the
 * caller awaits `prepareLaserRecoveryPreviewRoute` instead. */
export function prepareLaserRecoveryPreviewRouteNow(
  artifact: ExecutionArtifactV1,
): RecoveryPreviewRoute | null {
  const ready = readyRoutes.get(artifact);
  if (ready !== undefined) return ready;
  if (activeWorkerFactory() !== null) return null;
  const route = buildLaserRecoveryPreviewRoute(artifact);
  readyRoutes.set(artifact, route);
  pendingRoutes.set(artifact, Promise.resolve(route));
  return route;
}

/** Derive the route off the UI thread once per artifact and keep it while the
 * artifact object lives, so zooming, reopening and re-rendering never parse
 * the program again. */
export function prepareLaserRecoveryPreviewRoute(
  artifact: ExecutionArtifactV1,
): Promise<RecoveryPreviewRoute> {
  const pending = pendingRoutes.get(artifact);
  if (pending !== undefined) return pending;
  const source = laserRecoveryPreviewSource(artifact);
  const factory = activeWorkerFactory();
  const manifest =
    factory === null
      ? Promise.resolve().then(() => packRecoveryPreviewManifest(source))
      : packOffThread(factory, source);
  const route = manifest
    .then((packed) => {
      const prepared = routeFromSource(source, packed);
      readyRoutes.set(artifact, prepared);
      return prepared;
    })
    .catch((error: unknown) => {
      pendingRoutes.delete(artifact);
      throw error;
    });
  pendingRoutes.set(artifact, route);
  return route;
}

function packOffThread(
  factory: PreviewWorkerFactory,
  request: LaserRecoveryPreviewRequest,
): Promise<PackedMotionManifest> {
  return new Promise((resolve, reject) => {
    const worker = factory();
    if (worker === null) {
      resolve(packRecoveryPreviewManifest(request));
      return;
    }
    const settle = (outcome: () => void): void => {
      worker.terminate();
      outcome();
    };
    worker.onmessage = (event: MessageEvent<LaserRecoveryPreviewReply>) => {
      const reply = event.data;
      if ('error' in reply) settle(() => reject(new Error(reply.error)));
      else if (isPackedMotionManifest(reply.value)) settle(() => resolve(reply.value));
      else settle(() => reject(new Error('The route preview worker returned an invalid route.')));
    };
    worker.onerror = () =>
      settle(() =>
        reject(new Error('The route preview worker stopped before the saved route was ready.')),
      );
    worker.onmessageerror = () =>
      settle(() => reject(new Error('The route preview could not be read from its worker.')));
    try {
      const message: LaserRecoveryPreviewRequest = {
        gcode: request.gcode,
        initialPosition: request.initialPosition,
      };
      worker.postMessage(message);
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}
