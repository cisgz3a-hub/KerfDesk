import { artworkOperationRuns } from '../artwork-order';
import type { DeviceProfile } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncMachineConfig,
  type Scene,
} from '../scene';
import { collectLayerContours, layerPolylinesFromContours } from './collect-cnc-contours';
import type { VCarveLadder } from './vcarve-ladder';
import { vcarveMedialOptionsForLayer } from './vcarve-medial-options';
import {
  finalizeVCarveMedialWork,
  prepareVCarveMedialWork,
  runVCarveMedialRegionTask,
  type PreparedVCarveMedialWork,
  type VCarveMedialRegionTask,
  type VCarveMedialRegionTaskResult,
} from './vcarve-medial-work';

const ARTIFACT_STATE: unique symbol = Symbol('CncCompilationArtifactState');

export type CncCompilationIdentity = {
  /** Identity supplied by the caller for the logical Start/Save preparation. */
  readonly jobId: string;
  /** Unique binding for one immutable scene/device/config snapshot. */
  readonly compilationId: string;
};

export type CncCompilationTaskBinding = {
  readonly operationIndex: number;
  readonly layerId: string;
  readonly priorityObjectId: string;
  readonly normalizedIndex: number;
};

export type CncCompilationTaskPayload = {
  readonly binding: CncCompilationTaskBinding;
  readonly regionTask: VCarveMedialRegionTask;
};

export type CncCompilationTask = {
  readonly taskId: string;
  readonly payload: CncCompilationTaskPayload;
};

export type CncCompilationRegionResult = {
  readonly binding: CncCompilationTaskBinding;
  readonly regionResult: VCarveMedialRegionTaskResult;
};

export type CncCompilationTaskResult = {
  /** Worker-pool jobId. It must equal the artifact's compilationId. */
  readonly jobId: string;
  readonly taskId: string;
  readonly result: CncCompilationRegionResult;
};

export type PreparedCncCompilationArtifact = {
  readonly identity: CncCompilationIdentity;
  readonly tasks: ReadonlyArray<CncCompilationTask>;
  readonly [ARTIFACT_STATE]: ArtifactState;
};

export type CncVCarveLayerEvidence = {
  readonly operationIndex: number;
  readonly layerId: string;
  readonly priorityObjectId: string;
  readonly taskIds: ReadonlyArray<string>;
  readonly ladder: VCarveLadder;
};

export type CncCompilationEvidence = {
  readonly identity: CncCompilationIdentity;
  readonly vcarveLayers: ReadonlyArray<CncVCarveLayerEvidence>;
};

export type CncCompilationRejectionReason =
  | 'unknown-artifact'
  | 'incomplete-results'
  | 'job-mismatch'
  | 'unknown-task'
  | 'duplicate-task'
  | 'task-result-mismatch';

export type ResolvedCncCompilation =
  | { readonly kind: 'rejected'; readonly reason: CncCompilationRejectionReason }
  | {
      readonly kind: 'resolved';
      readonly scene: Scene;
      readonly device: DeviceProfile;
      readonly config: CncMachineConfig;
      readonly evidence: CncCompilationEvidence;
    };

type LayerWork = {
  readonly operationIndex: number;
  readonly layerId: string;
  readonly priorityObjectId: string;
  readonly work: PreparedVCarveMedialWork;
  readonly taskIds: ReadonlyArray<string>;
};

type ArtifactState = {
  readonly scene: Scene;
  readonly device: DeviceProfile;
  readonly config: CncMachineConfig;
  readonly layerWork: ReadonlyArray<LayerWork>;
  readonly expectedByTaskId: ReadonlyMap<string, CncCompilationTask>;
};

export function prepareCncCompilationArtifact(
  identity: CncCompilationIdentity,
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): PreparedCncCompilationArtifact {
  const snapshot = { scene, device, config };
  const { layerWork, tasks } = prepareLayerWork(scene, device, config);
  const frozenTasks = Object.freeze(
    tasks.map((task) =>
      Object.freeze({
        taskId: task.taskId,
        payload: Object.freeze({
          binding: Object.freeze({ ...task.payload.binding }),
          regionTask: task.payload.regionTask,
        }),
      }),
    ),
  );
  const state: ArtifactState = {
    ...snapshot,
    layerWork,
    expectedByTaskId: new Map(frozenTasks.map((task) => [task.taskId, task])),
  };
  return Object.freeze({
    identity: Object.freeze({ ...identity }),
    tasks: frozenTasks,
    [ARTIFACT_STATE]: state,
  });
}

/** Pure worker entry point; identity is carried by the pool envelope. */
export function runCncCompilationTask(
  payload: CncCompilationTaskPayload,
): CncCompilationRegionResult {
  return {
    binding: payload.binding,
    regionResult: runVCarveMedialRegionTask(payload.regionTask),
  };
}

export function resolveCncCompilationArtifact(
  artifact: PreparedCncCompilationArtifact,
  results: ReadonlyArray<CncCompilationTaskResult>,
): ResolvedCncCompilation {
  if (!(ARTIFACT_STATE in artifact)) return rejected('unknown-artifact');
  const state = artifact[ARTIFACT_STATE];
  if (results.length !== artifact.tasks.length) return rejected('incomplete-results');
  const checked = validateResults(artifact, state.expectedByTaskId, results);
  if (checked.kind === 'rejected') return checked;
  const vcarveLayers = state.layerWork.map((layer) => ({
    operationIndex: layer.operationIndex,
    layerId: layer.layerId,
    priorityObjectId: layer.priorityObjectId,
    taskIds: layer.taskIds,
    ladder: finalizeLayerWork(layer, checked.byTaskId),
  }));
  return {
    kind: 'resolved',
    scene: state.scene,
    device: state.device,
    config: state.config,
    evidence: { identity: artifact.identity, vcarveLayers },
  };
}

function prepareLayerWork(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): {
  readonly layerWork: ReadonlyArray<LayerWork>;
  readonly tasks: ReadonlyArray<CncCompilationTask>;
} {
  const layerWork: LayerWork[] = [];
  const tasks: CncCompilationTask[] = [];
  for (const [operationIndex, { layer, priorityObjectId }] of artworkOperationRuns(
    scene,
  ).entries()) {
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (settings.cutType !== 'v-carve') continue;
    const contours = collectLayerContours(scene.objects, layer, device);
    const polylines = layerPolylinesFromContours(layer, contours);
    const work = prepareVCarveMedialWork(
      polylines,
      vcarveMedialOptionsForLayer(settings, layerCncTool(config, settings)),
    );
    const regionTasks = work.kind === 'regions' ? work.tasks : [];
    const taskIds = regionTasks.map((task) => taskIdFor(operationIndex, task.normalizedIndex));
    layerWork.push({ operationIndex, layerId: layer.id, priorityObjectId, work, taskIds });
    tasks.push(
      ...regionTasks.map((regionTask, index) => {
        const binding = {
          operationIndex,
          layerId: layer.id,
          priorityObjectId,
          normalizedIndex: regionTask.normalizedIndex,
        };
        return {
          taskId: taskIds[index] ?? taskIdFor(operationIndex, index),
          payload: { binding, regionTask },
        };
      }),
    );
  }
  return { layerWork, tasks };
}

function validateResults(
  artifact: PreparedCncCompilationArtifact,
  expected: ReadonlyMap<string, CncCompilationTask>,
  results: ReadonlyArray<CncCompilationTaskResult>,
):
  | {
      readonly kind: 'checked';
      readonly byTaskId: ReadonlyMap<string, VCarveMedialRegionTaskResult>;
    }
  | Extract<ResolvedCncCompilation, { readonly kind: 'rejected' }> {
  const byTaskId = new Map<string, VCarveMedialRegionTaskResult>();
  for (const result of results) {
    if (result.jobId !== artifact.identity.compilationId) return rejected('job-mismatch');
    const task = expected.get(result.taskId);
    if (task === undefined) return rejected('unknown-task');
    if (byTaskId.has(result.taskId)) return rejected('duplicate-task');
    if (!bindingsEqual(result.result.binding, task.payload.binding)) {
      return rejected('task-result-mismatch');
    }
    if (result.result.regionResult.normalizedIndex !== task.payload.binding.normalizedIndex) {
      return rejected('task-result-mismatch');
    }
    byTaskId.set(result.taskId, result.result.regionResult);
  }
  return { kind: 'checked', byTaskId };
}

function finalizeLayerWork(
  layer: LayerWork,
  results: ReadonlyMap<string, VCarveMedialRegionTaskResult>,
): VCarveLadder {
  const ordered = layer.taskIds.flatMap((taskId) => {
    const result = results.get(taskId);
    return result === undefined ? [] : [result];
  });
  return finalizeVCarveMedialWork(layer.work, ordered);
}

function taskIdFor(operationIndex: number, normalizedIndex: number): string {
  return `vcarve:${operationIndex}:${normalizedIndex}`;
}

function bindingsEqual(left: CncCompilationTaskBinding, right: CncCompilationTaskBinding): boolean {
  return (
    left.operationIndex === right.operationIndex &&
    left.layerId === right.layerId &&
    left.priorityObjectId === right.priorityObjectId &&
    left.normalizedIndex === right.normalizedIndex
  );
}

function rejected(
  reason: CncCompilationRejectionReason,
): Extract<ResolvedCncCompilation, { readonly kind: 'rejected' }> {
  return { kind: 'rejected', reason };
}
