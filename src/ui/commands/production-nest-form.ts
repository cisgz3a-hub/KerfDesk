import type { Project } from '../../core/scene';
import type {
  ProductionNestDefinition,
  ProductionNestPart,
  ProductionNestStock,
} from '../../core/nesting/production-nest';
import type { ProcessRecipeResult } from '../../core/material-library/process-recipe';
import { productionPartObjects } from '../state/prepare-production-nest';

export function initialProductionDefinition(
  project: Project,
  ids: ReadonlyArray<string>,
): ProductionNestDefinition {
  if (project.productionNest !== undefined) {
    const { output: _output, ...definition } = project.productionNest;
    return definition;
  }
  const sheet = initialProductionStock(project, 'stock-1');
  const part = productionSelectionPart(project, ids, 'part-1', sheet);
  return {
    id: 'quantity-production',
    name: 'Quantity production',
    parts: part.kind === 'ok' ? [part.value] : [],
    sheets: [sheet],
    padding: 2,
    goal: 'compact',
    method: 'outline',
    optimise: false,
  };
}
export function initialProductionStock(project: Project, id: string): ProductionNestStock {
  const stock = project.machine?.kind === 'cnc' ? project.machine.stock : undefined;
  return {
    id,
    name: 'Stock ' + id,
    stockId: id,
    kind: 'sheet',
    materialKey: stock?.materialKey ?? 'Declared material',
    thicknessMm: stock?.thicknessMm ?? 10,
    widthMm: stock?.widthMm ?? project.workspace.width,
    heightMm: stock?.heightMm ?? project.workspace.height,
    grain: 'none',
  };
}
export function productionSelectionPart(
  project: Project,
  ids: ReadonlyArray<string>,
  id: string,
  stock: ProductionNestStock,
): ProcessRecipeResult<ProductionNestPart> {
  if (ids.length === 0)
    return { kind: 'invalid', reason: 'Select the artwork for a production part first.' };
  const attached = productionPartObjects(project, ids);
  if (attached.kind === 'invalid') return attached;
  if (attached.value.length === 0)
    return { kind: 'invalid', reason: 'The selected artwork is no longer available.' };
  return {
    kind: 'ok',
    value: {
      id,
      name: attached.value[0]?.name ?? 'Part ' + id,
      objectIds: attached.value.map((object) => object.id),
      quantity: 1,
      materialKey: stock.materialKey,
      thicknessMm: stock.thicknessMm,
      rotationAngles: [0, 90, 180, 270],
      grain: 'none',
    },
  };
}
export function freeProductionId(prefix: string, ids: ReadonlyArray<string>): string {
  let index = 1;
  while (ids.includes(prefix + index)) index += 1;
  return prefix + index;
}
