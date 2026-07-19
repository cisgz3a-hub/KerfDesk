import {
  machineKindOf,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { pushUndo, type StateSlice } from './scene-mutations';

export type AirAssistDefaultSyncSummary = {
  readonly airOutputUnset: boolean;
  readonly disabledOutputLayerCount: number;
  readonly disabledObjectOverrideCount: number;
  readonly needsSync: boolean;
};

type AirAssistDefaultState = StateSlice;

type AirAssistDefaultMutation =
  | {
      readonly project: Project;
      readonly undoStack: ReadonlyArray<Project>;
      readonly redoStack: ReadonlyArray<Project>;
      readonly dirty: true;
    }
  | Record<string, never>;

type AirAssistDefaultSet = (fn: (state: AirAssistDefaultState) => AirAssistDefaultMutation) => void;

export type AirAssistDefaultActions = {
  readonly syncProjectAirAssistDefaults: () => AirAssistDefaultSyncSummary;
};

export function projectAirAssistDefaultSyncSummary(project: Project): AirAssistDefaultSyncSummary {
  const outputLayers = outputLaserLayers(project);
  const disabledOutputLayerCount = outputLayers.filter((layer) => !layer.airAssist).length;
  const disabledObjectOverrideCount = project.scene.objects.filter((object) =>
    hasDisabledAirOverrideOnOutputLayer(object, outputLayers),
  ).length;
  const airOutputUnset = project.device.airAssistCommand === 'none';
  return {
    airOutputUnset,
    disabledOutputLayerCount,
    disabledObjectOverrideCount,
    needsSync: airOutputUnset || disabledOutputLayerCount > 0 || disabledObjectOverrideCount > 0,
  };
}

export function airAssistDefaultActions(
  set: AirAssistDefaultSet,
  get: () => AirAssistDefaultState,
): AirAssistDefaultActions {
  return {
    syncProjectAirAssistDefaults: () => {
      const summary = projectAirAssistDefaultSyncSummary(get().project);
      if (!summary.needsSync) return summary;
      set((state) => {
        const project = projectWithAirAssistDefaults(state.project);
        if (project === state.project) return {};
        return {
          project,
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      });
      return summary;
    },
  };
}

function projectWithAirAssistDefaults(project: Project): Project {
  const scene = sceneWithAirAssistDefaults(project);
  if (scene === project.scene) return project;
  return { ...project, scene };
}

function sceneWithAirAssistDefaults(project: Project): Scene {
  const outputLayers = outputLaserLayers(project);
  const outputLayerIds = new Set(outputLayers.map((layer) => layer.id));
  const layers = mapChanged(project.scene.layers, (layer) =>
    outputLayerIds.has(layer.id) && !layer.airAssist ? { ...layer, airAssist: true } : layer,
  );
  const objects = mapChanged(project.scene.objects, (object) =>
    objectWithAirAssistOverrideEnabled(object, outputLayers),
  );
  if (layers === project.scene.layers && objects === project.scene.objects) return project.scene;
  return { ...project.scene, layers, objects };
}

function outputLaserLayers(project: Project): ReadonlyArray<Layer> {
  if (machineKindOf(project.machine) === 'cnc') return [];
  return project.scene.layers.filter((layer) => layer.output);
}

function objectWithAirAssistOverrideEnabled(
  object: SceneObject,
  outputLayers: ReadonlyArray<Layer>,
): SceneObject {
  if (!hasDisabledAirOverrideOnOutputLayer(object, outputLayers)) return object;
  return { ...object, operationOverride: { ...object.operationOverride, airAssist: true } };
}

function hasDisabledAirOverrideOnOutputLayer(
  object: SceneObject,
  outputLayers: ReadonlyArray<Layer>,
): boolean {
  if (object.operationOverride?.airAssist !== false) return false;
  return outputLayers.some((operation) => sceneObjectUsesOperation(object, operation));
}

function mapChanged<T>(items: ReadonlyArray<T>, mapItem: (item: T) => T): ReadonlyArray<T> {
  let changed = false;
  const next = items.map((item) => {
    const mapped = mapItem(item);
    if (mapped !== item) changed = true;
    return mapped;
  });
  return changed ? next : items;
}
