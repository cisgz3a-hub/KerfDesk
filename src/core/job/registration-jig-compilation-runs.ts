import { orderedArtworkObjects } from '../artwork-order';
import { registrationJigArtworkInstances } from '../scene/registration-jig-artwork';
import { sceneObjectUsesOperation, type Layer, type Scene, type SceneObject } from '../scene';

export type RegistrationJigCompilationRun = {
  readonly layer: Layer;
  readonly priorityObjectId: string;
  readonly rasterObjects: ReadonlyArray<SceneObject>;
  readonly vectorObjects: ReadonlyArray<SceneObject>;
};

/** Repeats shared operations per physical jig so one piece finishes before the next starts. */
export function registrationJigCompilationRuns(
  scene: Scene,
): ReadonlyArray<RegistrationJigCompilationRun> | null {
  const instances = registrationJigArtworkInstances(scene);
  if (instances.length === 0) return null;
  const jigObjectIds = new Set(
    instances.flatMap((instance) => instance.objects.map((object) => object.id)),
  );
  const ordinarySceneObjects = scene.objects.filter((object) => !jigObjectIds.has(object.id));
  const orderedObjects = orderedArtworkObjects(scene);
  const ordinaryOrderedObjects = orderedObjects.filter((object) => !jigObjectIds.has(object.id));
  const scheduledOrdinaryLayers = new Set<string>();
  const runs: RegistrationJigCompilationRun[] = [];
  let jigSetScheduled = false;
  for (const object of orderedObjects) {
    if (jigObjectIds.has(object.id)) {
      if (!jigSetScheduled) runs.push(...jigInstanceRuns(scene.layers, instances));
      jigSetScheduled = true;
      continue;
    }
    runs.push(
      ...ordinaryRunsForObject(
        scene.layers,
        object,
        ordinarySceneObjects,
        ordinaryOrderedObjects,
        scheduledOrdinaryLayers,
      ),
    );
  }
  return runs;
}

function jigInstanceRuns(
  layers: ReadonlyArray<Layer>,
  instances: ReturnType<typeof registrationJigArtworkInstances>,
): ReadonlyArray<RegistrationJigCompilationRun> {
  return instances.flatMap((instance) =>
    layers.flatMap((layer) => {
      if (!layer.output) return [];
      const priorityObject = instance.objects.find((candidate) =>
        sceneObjectUsesOperation(candidate, layer),
      );
      return priorityObject === undefined
        ? []
        : [
            {
              layer,
              priorityObjectId: priorityObject.id,
              rasterObjects: instance.objects,
              vectorObjects: instance.objects,
            },
          ];
    }),
  );
}

function ordinaryRunsForObject(
  layers: ReadonlyArray<Layer>,
  object: SceneObject,
  sceneObjects: ReadonlyArray<SceneObject>,
  orderedObjects: ReadonlyArray<SceneObject>,
  scheduledLayers: Set<string>,
): ReadonlyArray<RegistrationJigCompilationRun> {
  const runs: RegistrationJigCompilationRun[] = [];
  for (const layer of layers) {
    if (
      !layer.output ||
      scheduledLayers.has(layer.id) ||
      !sceneObjectUsesOperation(object, layer)
    ) {
      continue;
    }
    scheduledLayers.add(layer.id);
    runs.push({
      layer,
      priorityObjectId: object.id,
      rasterObjects: orderedObjects,
      vectorObjects: sceneObjects,
    });
  }
  return runs;
}
