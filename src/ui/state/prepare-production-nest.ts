import { combinedBBox, type Bounds, type Project, type SceneObject } from '../../core/scene';
import type {
  ProductionNestDefinition,
  ProductionNestingInput,
} from '../../core/nesting/production-nest';
import type { ProcessRecipeResult } from '../../core/material-library/process-recipe';
import { parseProductionNestDefinition } from '../../io/project/project-production-nest-validator';
import {
  sceneObjectCopyClosure,
  sceneObjectCopyDependencyIds,
} from './scene-object-copy-dependencies';
import { outlineForNestUnit } from './nest-outline';
import { productionLinkedDependencyIds } from './production-nest-linked-copy';

export type ProductionNestUnit = {
  readonly partId: string;
  readonly objects: ReadonlyArray<SceneObject>;
  readonly bounds: Bounds;
};
export type PreparedProductionNest = {
  readonly project: Project;
  readonly input: ProductionNestingInput;
  readonly units: ReadonlyArray<ProductionNestUnit>;
};

export function prepareProductionNest(
  project: Project,
  definition: ProductionNestDefinition,
): ProcessRecipeResult<PreparedProductionNest> {
  const parsed = parseProductionNestDefinition(definition);
  if (parsed.kind === 'invalid') return parsed;
  if (parsed.value === undefined)
    return invalid('Define parts and sheets before quantity nesting.');
  const units: ProductionNestUnit[] = [];
  const geometry: ProductionNestingInput['geometry'][number][] = [];
  for (const part of parsed.value.parts) {
    const sources = productionPartObjects(project, part.objectIds);
    if (sources.kind === 'invalid') return invalid(part.name + ': ' + sources.reason);
    const bounds = combinedBBox(sources.value);
    if (bounds === null || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) continue;
    units.push({ partId: part.id, objects: sources.value, bounds });
    geometry.push({
      partId: part.id,
      item: {
        id: part.id,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
        canRotate: true,
        rotationAngles: part.rotationAngles,
        ...(definition.method === 'outline' ? outlineForNestUnit(sources.value, bounds) : {}),
      },
      vectorLengthMm: vectorLength(sources.value),
    });
  }
  const outlineCopies = geometry.reduce(
    (count, source) =>
      count +
      (source.item.outline ?? []).reduce((points, path) => points + path.length, 0) *
        (parsed.value?.parts.find((part) => part.id === source.partId)?.quantity ?? 0),
    0,
  );
  if (outlineCopies > 500_000)
    return invalid(
      'Requested outline copies exceed 500000 points. Use conservative rectangular bounds or reduce the quantities.',
    );
  const estimatedBytes = units.reduce(
    (size, unit) =>
      size +
      JSON.stringify(unit.objects).length *
        (parsed.value?.parts.find((part) => part.id === unit.partId)?.quantity ?? 0),
    0,
  );
  if (estimatedBytes > 50_000_000)
    return invalid(
      'Attached artwork copies would exceed 50 MB. Reduce quantities or split the production definition.',
    );
  const members = units.reduce(
    (count, unit) =>
      count +
      unit.objects.length *
        (parsed.value?.parts.find((part) => part.id === unit.partId)?.quantity ?? 0),
    0,
  );
  if (members > 10_000)
    return invalid(
      'Requested attached artwork exceeds 10000 generated objects. Reduce quantities or split the production definition.',
    );
  return { kind: 'ok', value: { project, input: { definition: parsed.value, geometry }, units } };
}
export function productionPartObjects(
  project: Project,
  objectIds: ReadonlyArray<string>,
): ProcessRecipeResult<ReadonlyArray<SceneObject>> {
  const ids = new Set(objectIds);
  if (objectIds.some((id) => !project.scene.objects.some((object) => object.id === id)))
    return { kind: 'ok', value: [] };
  let changed = true;
  while (changed) {
    const size = ids.size;
    for (const group of project.scene.groups ?? [])
      if (group.objectIds.some((id) => ids.has(id))) group.objectIds.forEach((id) => ids.add(id));
    for (const object of sceneObjectCopyClosure(project.scene.objects, ids)) {
      ids.add(object.id);
      productionLinkedDependencyIds(project, object).forEach((id) => ids.add(id));
    }
    changed = ids.size !== size;
  }
  const objects = project.scene.objects.filter((object) => ids.has(object.id));
  if (objects.some((object) => object.locked === true))
    return invalid('Unlock all attached artwork before preparing this part.');
  const present = new Set(objects.map((object) => object.id));
  if (
    objects.some((object) =>
      [
        ...sceneObjectCopyDependencyIds(object),
        ...productionLinkedDependencyIds(project, object),
      ].some((id) => !present.has(id)),
    )
  )
    return invalid(
      'Restore missing mask, lettering guide, relief boundary or projection-target artwork.',
    );
  return { kind: 'ok', value: objects };
}
function vectorLength(objects: ReadonlyArray<SceneObject>): number {
  let total = 0;
  for (const object of objects) {
    if (!('paths' in object)) continue;
    for (const path of object.paths)
      for (const line of path.polylines) {
        for (let index = 1; index < line.points.length; index += 1) {
          const point = line.points[index],
            previous = line.points[index - 1];
          if (point !== undefined && previous !== undefined)
            total += Math.hypot(
              (point.x - previous.x) * object.transform.scaleX,
              (point.y - previous.y) * object.transform.scaleY,
            );
        }
        const first = line.points[0],
          last = line.points[line.points.length - 1];
        if (line.closed && first !== undefined && last !== undefined)
          total += Math.hypot(
            (first.x - last.x) * object.transform.scaleX,
            (first.y - last.y) * object.transform.scaleY,
          );
      }
  }
  return total;
}
function invalid(reason: string): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason };
}
