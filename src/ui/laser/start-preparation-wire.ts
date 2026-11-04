// How a Start preparation crosses the output-preparation worker boundary
// without one long structured clone on the UI thread (performance audit
// S1-P2-2, ADR-598 Amendment 4). At 374,843 lines the window spent 472 ms in
// one task receiving the result, about half for the prepared project's scene
// and half for the compiled fill segments, before Job Review could open.
//
//   - The prepared project's scene objects are the request's own objects
//     inside the worker (output scope only filters them). The window already
//     holds the originals the worker's copy was unpacked from (ADR-598
//     decision 1), so they travel as indices and the window re-attaches its
//     own. Objects the worker made itself (hydrated rasters, materialized
//     relief) still travel whole.
//   - Fill segments of the plain shape travel as transferred Float64Array
//     columns and are rebuilt in time slices, each its own task, before the
//     preparation resolves. A segment of any other shape keeps its group as
//     plain objects.
//   - The fill heat analysis and the program facts Job Review reads are sent
//     beside the job, so the window seeds them instead of replanning every
//     sweep and walking the program again.
//
// Nothing here changes a value: the rebuilt preparation is equal, field by
// field and in key order, to the one the worker built.

import type { FillGroup, FillSegment, Group, Job, ScanOffsetPoint } from '../../core/job';
import type { Project, Scene, SceneObject } from '../../core/scene';
import type { TransferredStartJobPreparation } from './output-preparation-protocol';
import {
  memoizedFillHeatRisk,
  seedFillHeatRisk,
  type FillHeatRisk,
} from './job-review/fill-heat-risk-memo';
import {
  measureProgramFacts,
  seedProgramFacts,
  type ProgramFacts,
} from './job-review/program-facts';

type TransferredOk = Extract<TransferredStartJobPreparation, { readonly ok: true }>;
type PreparedProject = TransferredOk['prepared']['project'];

/** The prepared scene, with objects the request already carried as indices. */
type WireScene = Omit<Scene, 'objects'> & {
  /** The scene's own key order, so the rebuilt scene matches exactly. */
  readonly sceneKeys: ReadonlyArray<string>;
  /** `objectIndices[i]` is the request's object for output object i, or -1
   * for the next entry of `ownObjects`. */
  readonly objectIndices: Int32Array;
  readonly ownObjects: ReadonlyArray<SceneObject>;
};

/** Plain fill segments (`polyline`, `closed`, `reverse`; points `x`, `y`) as columns. */
type PackedFillSegments = {
  /** The segments' own key order, kept so a rebuilt segment matches exactly. */
  readonly keys: ReadonlyArray<string>;
  readonly coords: Float64Array;
  /** Point offsets: segment i owns points pointStarts[i] to pointStarts[i + 1]. */
  readonly pointStarts: Uint32Array;
  /** Bit 0: closed. Bit 1: reverse. */
  readonly flags: Uint8Array;
};

type WireFillGroup = Omit<FillGroup, 'segments'> & {
  readonly packedSegments: PackedFillSegments;
  /** The group's own key order, so the rebuilt group matches exactly. */
  readonly groupKeys: ReadonlyArray<string>;
};
type WireGroup = Exclude<Group, FillGroup> | FillGroup | WireFillGroup;

export type StartPreparationWire =
  | Extract<TransferredStartJobPreparation, { readonly ok: false }>
  | {
      readonly wire: 'start-preparation-v1';
      readonly result: Omit<TransferredOk, 'prepared'> & {
        readonly prepared: Omit<TransferredOk['prepared'], 'project' | 'job'> & {
          readonly project: Omit<PreparedProject, 'scene'> & { readonly scene: WireScene };
          readonly job: Omit<Job, 'groups'> & { readonly groups: ReadonlyArray<WireGroup> };
        };
      };
      readonly fillHeatRisk: {
        readonly scanningOffsets: ReadonlyArray<ScanOffsetPoint>;
        readonly risk: FillHeatRisk;
      };
      readonly programFacts: ProgramFacts;
    };

const PLAIN_SEGMENT_KEYS = new Set(['polyline', 'closed', 'reverse']);
// A slice of the rebuild stays well under the 200 ms design budget.
const REBUILD_SLICE_MS = 24;

/** Worker side. `requestProject` is the project the worker unpacked from the request. */
export function packStartPreparationForWire(
  result: TransferredStartJobPreparation,
  requestProject: Project,
): { readonly message: StartPreparationWire; readonly transfer: ArrayBuffer[] } {
  if (!result.ok) return { message: result, transfer: [] };
  const transfer: ArrayBuffer[] = [];
  const { project, job } = result.prepared;
  const scanningOffsets = requestProject.device.scanningOffsets;
  const message: StartPreparationWire = {
    wire: 'start-preparation-v1',
    result: {
      ...result,
      prepared: {
        ...result.prepared,
        project: { ...project, scene: wireScene(project.scene, requestProject.scene, transfer) },
        job: { ...job, groups: job.groups.map((group) => wireGroup(group, transfer)) },
      },
    },
    // The worker's own warnings already analysed this job; the memo returns it.
    fillHeatRisk: { scanningOffsets, risk: memoizedFillHeatRisk(job, scanningOffsets) },
    programFacts: measureProgramFacts(result.gcode),
  };
  return { message, transfer };
}

/** Window side: the exact preparation the worker built. Yields between slices. */
export async function unpackStartPreparationFromWire(
  message: StartPreparationWire | TransferredStartJobPreparation,
  requestProject: Project,
  signal?: AbortSignal,
): Promise<TransferredStartJobPreparation> {
  if (!('wire' in message)) return message;
  const { result } = message;
  const groups: Group[] = [];
  const slicer = new RebuildSlicer(signal);
  for (const group of result.prepared.job.groups) {
    groups.push('packedSegments' in group ? await rebuildFillGroup(group, slicer) : group);
  }
  const { scene, ...projectRest } = result.prepared.project;
  const job: Job = { ...result.prepared.job, groups };
  seedFillHeatRisk(job, message.fillHeatRisk.scanningOffsets, message.fillHeatRisk.risk);
  const restored: TransferredStartJobPreparation = {
    ...result,
    prepared: {
      ...result.prepared,
      project: { ...projectRest, scene: sceneFromWire(scene, requestProject.scene) },
      job,
    },
  };
  seedProgramFacts(restored, message.programFacts);
  return restored;
}

function wireScene(scene: Scene, requestScene: Scene, transfer: ArrayBuffer[]): WireScene {
  const indexOf = new Map<SceneObject, number>();
  requestScene.objects.forEach((object, index) => indexOf.set(object, index));
  const objectIndices = new Int32Array(scene.objects.length);
  const ownObjects: SceneObject[] = [];
  scene.objects.forEach((object, index) => {
    const shared = indexOf.get(object);
    objectIndices[index] = shared ?? -1;
    if (shared === undefined) ownObjects.push(object);
  });
  transfer.push(bufferOf(objectIndices));
  const { objects: _objects, ...rest } = scene;
  return { ...rest, sceneKeys: Object.keys(scene), objectIndices, ownObjects };
}

function sceneFromWire(wire: WireScene, requestScene: Scene): Scene {
  const { sceneKeys, objectIndices, ownObjects, ...rest } = wire;
  let own = 0;
  const objects = Array.from(objectIndices, (shared) => {
    const object = shared < 0 ? ownObjects[own++] : requestScene.objects[shared];
    if (object === undefined) throw new Error('Start preparation named a scene object it lacks.');
    return object;
  });
  return inKeyOrder<Scene>(sceneKeys, { ...rest, objects });
}

function wireGroup(group: Group, transfer: ArrayBuffer[]): WireGroup {
  if (group.kind !== 'fill' || group.segments.length === 0) return group;
  const packed = packFillSegments(group.segments);
  if (packed === null) return group;
  transfer.push(bufferOf(packed.coords), bufferOf(packed.pointStarts), bufferOf(packed.flags));
  const { segments: _segments, ...rest } = group;
  return { ...rest, packedSegments: packed, groupKeys: Object.keys(group) };
}

function packFillSegments(segments: ReadonlyArray<FillSegment>): PackedFillSegments | null {
  const first = segments[0];
  if (first === undefined) return null;
  const keys = Object.keys(first);
  if (keys.length !== PLAIN_SEGMENT_KEYS.size || !keys.every((key) => PLAIN_SEGMENT_KEYS.has(key)))
    return null;
  let points = 0;
  for (const segment of segments) {
    if (!sameKeys(segment, keys) || !Array.isArray(segment.polyline)) return null;
    if (typeof segment.closed !== 'boolean' || typeof segment.reverse !== 'boolean') return null;
    for (const point of segment.polyline) if (!isPlainPoint(point)) return null;
    points += segment.polyline.length;
  }
  const coords = new Float64Array(points * 2);
  const pointStarts = new Uint32Array(segments.length + 1);
  const flags = new Uint8Array(segments.length);
  let cursor = 0;
  segments.forEach((segment, index) => {
    pointStarts[index] = cursor / 2;
    for (const point of segment.polyline) {
      coords[cursor++] = point.x;
      coords[cursor++] = point.y;
    }
    flags[index] = (segment.closed ? 1 : 0) | (segment.reverse ? 2 : 0);
  });
  pointStarts[segments.length] = cursor / 2;
  return { keys, coords, pointStarts, flags };
}

// Each column is freshly allocated here, never a view of shared memory.
function bufferOf(column: Int32Array | Float64Array | Uint32Array | Uint8Array): ArrayBuffer {
  return column.buffer as ArrayBuffer;
}

function sameKeys(value: object, keys: ReadonlyArray<string>): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && own.every((key, index) => key === keys[index]);
}

// `{ x, y }` in that order with number values, as every compiled point is.
function isPlainPoint(point: unknown): boolean {
  if (
    typeof point !== 'object' ||
    point === null ||
    Object.getPrototypeOf(point) !== Object.prototype
  )
    return false;
  const keys = Object.keys(point);
  const { x, y } = point as { readonly x?: unknown; readonly y?: unknown };
  return (
    keys.length === 2 &&
    keys[0] === 'x' &&
    keys[1] === 'y' &&
    typeof x === 'number' &&
    typeof y === 'number'
  );
}

async function rebuildFillGroup(group: WireFillGroup, slicer: RebuildSlicer): Promise<FillGroup> {
  const { packedSegments, groupKeys, ...rest } = group;
  const { keys, coords, pointStarts, flags } = packedSegments;
  const segments: FillSegment[] = new Array<FillSegment>(flags.length);
  for (let index = 0; index < flags.length; index += 1) {
    if ((index & 1023) === 0) await slicer.maybeYield();
    const polyline = new Array<{ readonly x: number; readonly y: number }>(
      (pointStarts[index + 1] ?? 0) - (pointStarts[index] ?? 0),
    );
    for (let point = 0; point < polyline.length; point += 1) {
      const at = ((pointStarts[index] ?? 0) + point) * 2;
      polyline[point] = { x: coords[at] ?? 0, y: coords[at + 1] ?? 0 };
    }
    const flag = flags[index] ?? 0;
    const closed = (flag & 1) !== 0;
    const reverse = (flag & 2) !== 0;
    segments[index] = inKeyOrder<FillSegment>(keys, { polyline, closed, reverse });
  }
  return inKeyOrder<FillGroup>(groupKeys, { ...rest, segments });
}

/** `values` with its keys in the order `keys` lists them. */
function inKeyOrder<T>(keys: ReadonlyArray<string>, values: object): T {
  const source = values as Readonly<Record<string, unknown>>;
  const ordered: Record<string, unknown> = {};
  for (const key of keys) ordered[key] = source[key];
  return ordered as T;
}

class RebuildSlicer {
  private sliceStart = performance.now();

  constructor(private readonly signal: AbortSignal | undefined) {}

  async maybeYield(): Promise<void> {
    if (performance.now() - this.sliceStart < REBUILD_SLICE_MS) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (this.signal?.aborted === true) {
      const error = new Error('Background output preparation cancelled.');
      error.name = 'AbortError';
      throw error;
    }
    this.sliceStart = performance.now();
  }
}
