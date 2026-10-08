import {
  combinedBBox,
  type Project,
  type SceneGroup,
  type SceneObject,
  type Layer,
} from '../../core/scene';
import { nestRotation } from '../../core/nesting/quick-nest';
import { unitVectorForDegrees } from '../../core/scene/array-layout-math';
import type { ProductionNestPlacement } from '../../core/nesting/production-nest';
import type { ProductionNestApplication } from './production-nest-sheet-materialize';
import {
  copyProductionProjectionLayers,
  remapProductionOperationBindings,
  remapProductionProjection,
  remapProductionReliefLinks,
} from './production-nest-linked-copy';
import type { ProductionNestUnit } from './prepare-production-nest';
import { remapSceneObjectCopyDependencies } from './scene-object-copy-dependencies';
import { cloneSelectionGroups } from './clone-selection-groups';
import { snapshotRecipeBinding } from '../../core/material-library/process-recipe-binding';
import type { ProcessRecipeApplication } from '../../core/material-library/process-recipe-application';

export function materializeProductionPart(
  project: Project,
  unit: ProductionNestUnit,
  placement: ProductionNestPlacement,
  prefix: string,
  existingColors: ReadonlyArray<Pick<Layer, 'color'>> = project.scene.layers,
): ProductionNestApplication {
  const copied = new Map(
    unit.objects.map((object, index) => [object.id, prefix + '-o' + (index + 1)]),
  );
  const rawObjects = placeProductionUnit(unit, placement).map((object) =>
    remapSceneObjectCopyDependencies(
      { ...structuredClone(object), id: copied.get(object.id) ?? object.id } as SceneObject,
      copied,
    ),
  );
  const { layers, operationIds } = copyProductionProjectionLayers(
    project,
    unit.objects,
    copied,
    prefix,
    existingColors,
  );
  const objects = rawObjects.map((object) =>
    remapProductionOperationBindings(
      remapProductionReliefLinks(object, copied),
      project.scene.layers,
      operationIds,
    ),
  );
  let groupCount = 0;
  const groups = cloneSelectionGroups(
    project.scene.groups ?? [],
    new Set(copied.keys()),
    copied,
    () => prefix + '-g' + ++groupCount,
  );
  if (groups.length === 0 && objects.length >= 2)
    groups.push({
      id: prefix + '-part',
      name: unit.partId,
      objectIds: objects.map((object) => object.id),
    });
  return {
    objects,
    groups,
    layers,
    copied,
    applications: copiedRecipeApplications(project, copied, objects, operationIds, layers),
  };
}
function placeProductionUnit(
  unit: ProductionNestUnit,
  placement: ProductionNestPlacement,
): ReadonlyArray<SceneObject> {
  const angle = nestRotation(placement);
  const vector = unitVectorForDegrees(angle);
  const center = {
    x: (unit.bounds.minX + unit.bounds.maxX) / 2,
    y: (unit.bounds.minY + unit.bounds.maxY) / 2,
  };
  const rotated = unit.objects.map((object) => {
    const x = object.transform.x - center.x,
      y = object.transform.y - center.y;
    return {
      ...object,
      transform: {
        ...object.transform,
        x: center.x + x * vector.x - y * vector.y,
        y: center.y + x * vector.y + y * vector.x,
        rotationDeg: (object.transform.rotationDeg + angle) % 360,
      },
    } as SceneObject;
  });
  const bounds = combinedBBox(rotated);
  if (bounds === null) return rotated;
  const dx = placement.x - bounds.minX,
    dy = placement.y - bounds.minY;
  return rotated.map(
    (object) =>
      ({
        ...object,
        transform: { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy },
      }) as SceneObject,
  );
}
function copiedRecipeApplications(
  project: Project,
  copied: ReadonlyMap<string, string>,
  objects: ReadonlyArray<SceneObject>,
  operations: ReadonlyMap<string, string>,
  copiedLayers: ReadonlyArray<Layer>,
): ReadonlyArray<ProcessRecipeApplication> {
  return (project.processRecipeApplications ?? []).flatMap((application, applicationIndex) => {
    const objectIds = application.objectIds.flatMap((id) => copied.get(id) ?? []);
    if (objectIds.length === 0) return [];
    return [
      {
        ...application,
        recipe: {
          ...application.recipe,
          steps: application.recipe.steps.map((step) => ({
            ...step,
            ...(step.cnc === undefined ? {} : { cnc: remapProductionProjection(step.cnc, copied) }),
          })),
        },
        id: hasCopiedRecipeProjection(application, operations, copied)
          ? (objects[0]?.id ?? 'copy') + '-template-' + (applicationIndex + 1)
          : application.id,
        operations: application.operations.map((entry) => ({
          ...entry,
          operationId: operations.get(entry.operationId) ?? entry.operationId,
          baseline: {
            ...entry.baseline,
            color:
              copiedLayers.find((layer) => layer.id === operations.get(entry.operationId))?.color ??
              entry.baseline.color,
            ...(entry.baseline.cnc === undefined
              ? {}
              : { cnc: remapProductionProjection(entry.baseline.cnc, copied) }),
          },
        })),
        objectIds,
        bindings: objects
          .filter((object) => objectIds.includes(object.id))
          .map((object) => snapshotRecipeBinding(object, project.scene.layers)),
      },
    ];
  });
}
export function mergeProductionRecipeApplications(
  applications: ReadonlyArray<ProcessRecipeApplication>,
): ReadonlyArray<ProcessRecipeApplication> {
  const grouped = new Map<string, ProcessRecipeApplication>();
  for (const application of applications) {
    const previous = grouped.get(application.id);
    grouped.set(
      application.id,
      previous === undefined
        ? application
        : {
            ...previous,
            objectIds: [...previous.objectIds, ...application.objectIds],
            bindings: [...previous.bindings, ...application.bindings],
          },
    );
  }
  return [...grouped.values()];
}
export type ProductionPartClone = {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly groups: ReadonlyArray<SceneGroup>;
};

function hasCopiedRecipeProjection(
  application: ProcessRecipeApplication,
  operations: ReadonlyMap<string, string>,
  copied: ReadonlyMap<string, string>,
): boolean {
  return (
    application.operations.some((entry) => operations.has(entry.operationId)) ||
    application.recipe.steps.some(
      (step) =>
        step.cnc?.reliefProjection !== undefined &&
        copied.has(step.cnc.reliefProjection.reliefObjectId),
    )
  );
}
