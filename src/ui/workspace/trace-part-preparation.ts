import {
  sceneLayerVisibility,
  type ColoredPath,
  type Layer,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import {
  cacheTracePartBounds,
  hasTracePartBounds,
  prepareTracePartBounds,
} from '../../core/trace/trace-part-bounds';
import {
  cacheTracePartGroups,
  cachedTracePartGroups,
  computeTracePartGroups,
  tracePartGroupMode,
  type TracePartGroupMode,
} from '../../core/trace/trace-part-groups';
import {
  cancelTracePartWorker,
  prepareTracePartPathOffThread,
  TracePartPreparationCancelled,
} from './trace-part-worker-client';
import { setTracePartPreparationStatus } from './trace-part-preparation-store';

// Bound synchronous work by both contours and vertices. The contour weight
// accounts for grouping's containment search, even on short closed polygons.
export const TRACE_PART_SYNC_WORK_LIMIT = 8_000;
type Job = { readonly path: ColoredPath; readonly mode: TracePartGroupMode | null };
type Owner = {
  readonly scene: Scene;
  readonly epoch: number;
  readonly generation: number;
  ready: boolean;
};
const workCache = new WeakMap<ColoredPath, number>();
let owner: Owner | null = null;
let generation = 0;
let failed = false;

export function tracePartPathWork(path: ColoredPath): number {
  const cached = workCache.get(path);
  if (cached !== undefined) return cached;
  const contours = path.curves ?? path.polylines;
  let work = contours.length * 16;
  for (const contour of contours)
    work += 'segments' in contour ? contour.segments.length : contour.points.length;
  workCache.set(path, work);
  return work;
}

/** Returns false while preparing; a click is never replayed against a newer scene. */
export function ensureTracePartSceneReady(scene: Scene, epoch: number): boolean {
  if (owner?.scene === scene && owner.epoch === epoch) {
    return !failed && owner.ready;
  }
  cancelTracePartPreparation();
  const active: Owner = { scene, epoch, generation: ++generation, ready: false };
  owner = active;
  const jobs = missingJobs(scene);
  if (jobs.length === 0) {
    active.ready = true;
    setTracePartPreparationStatus('ready');
    return true;
  }
  const work = jobs.reduce((sum, job) => sum + tracePartPathWork(job.path), 0);
  if (work <= TRACE_PART_SYNC_WORK_LIMIT) {
    for (const job of jobs) prepareSmallJob(job);
    active.ready = true;
    setTracePartPreparationStatus('ready');
    return true;
  }
  setTracePartPreparationStatus('preparing');
  void prepareJobs(active, jobs);
  return false;
}

export function cancelTracePartPreparation(): void {
  owner = null;
  generation += 1;
  failed = false;
  cancelTracePartWorker();
  setTracePartPreparationStatus('idle');
}

export function retryTracePartPreparation(): void {
  const current = owner;
  if (current === null) return;
  cancelTracePartPreparation();
  ensureTracePartSceneReady(current.scene, current.epoch);
}

/** Selection guards must not synchronously group a restored dense whole trace. */
export function isPreparedSingleTracePart(
  object: SceneObject,
  layers: ReadonlyArray<Layer>,
): boolean {
  if (object.kind !== 'traced-image') return false;
  let count = 0;
  let work = 0;
  for (const path of object.paths) {
    const mode = tracePartGroupMode(object, path, layers);
    let groups = cachedTracePartGroups(path, mode);
    if (groups === undefined) {
      work += tracePartPathWork(path);
      if (work > TRACE_PART_SYNC_WORK_LIMIT) return false;
      groups = computeTracePartGroups(path, mode);
      cacheTracePartGroups(path, mode, groups);
    }
    count += groups.length;
    if (count > 1) return false;
  }
  return count === 1;
}

function missingJobs(scene: Scene): Job[] {
  const jobs: Job[] = [];
  const seen = new Map<ColoredPath, Set<TracePartGroupMode | null>>();
  const visibility = sceneLayerVisibility.lookup(scene.layers);
  for (const object of scene.objects) {
    if (
      !('paths' in object) ||
      object.locked === true ||
      !sceneLayerVisibility.hasObject(object, visibility)
    )
      continue;
    for (const path of object.paths) {
      // A visible trace's single-part check counts hidden subpaths as well.
      // Other vector artwork only needs its painted paths for occlusion.
      if (
        object.kind !== 'traced-image' &&
        !sceneLayerVisibility.resolvePath(object, path, visibility).visible
      )
        continue;
      const mode =
        object.kind === 'traced-image' ? tracePartGroupMode(object, path, scene.layers) : null;
      if (jobReady(path, mode)) continue;
      const modes = seen.get(path) ?? new Set<TracePartGroupMode | null>();
      if (modes.has(mode)) continue;
      modes.add(mode);
      seen.set(path, modes);
      jobs.push({ path, mode });
    }
  }
  return jobs;
}

function jobReady(path: ColoredPath, mode: TracePartGroupMode | null): boolean {
  return (
    hasTracePartBounds(path) && (mode === null || cachedTracePartGroups(path, mode) !== undefined)
  );
}

function prepareSmallJob(job: Job): void {
  prepareTracePartBounds(job.path);
  if (job.mode !== null)
    cacheTracePartGroups(job.path, job.mode, computeTracePartGroups(job.path, job.mode));
}

async function prepareJobs(active: Owner, jobs: ReadonlyArray<Job>): Promise<void> {
  try {
    for (const job of jobs) {
      const result = await prepareTracePartPathOffThread(job.path, job.mode);
      if (owner !== active || generation !== active.generation) return;
      cacheTracePartBounds(job.path, result.bounds);
      if (job.mode !== null) {
        if (result.groups === null) throw new Error('Trace preparation returned no part groups.');
        cacheTracePartGroups(job.path, job.mode, result.groups);
      }
    }
    if (owner === active) {
      active.ready = true;
      setTracePartPreparationStatus('ready');
    }
  } catch (error) {
    if (owner !== active || error instanceof TracePartPreparationCancelled) return;
    failed = true;
    setTracePartPreparationStatus(
      'error',
      'Trace parts could not be prepared. Retry, or finish editing and try again.',
    );
  } finally {
    if (owner === active) cancelTracePartWorker();
  }
}
