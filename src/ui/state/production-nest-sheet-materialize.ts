import { isChiploadMaterialKey } from '../../core/cnc/cnc-material-catalog';
import {
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import type { ProcessRecipeApplication } from '../../core/material-library/process-recipe-application';
import type { ProductionNestResult, ProductionNestStock } from '../../core/nesting/production-nest';
import { validateProductionNest } from '../../core/nesting/production-nest-validation';
import type { ProcessRecipeResult } from '../../core/material-library/process-recipe';
import { deserializeProject, serializeProject } from '../../io/project';
import type { PreparedProductionNest } from './prepare-production-nest';
import { remapProductionSetup } from './production-nest-linked-copy';
import {
  materializeProductionPart,
  mergeProductionRecipeApplications,
} from './production-nest-part-materialize';

export type ProductionNestApplication = {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly layers: ReadonlyArray<Layer>;
  readonly copied: ReadonlyMap<string, string>;
  readonly groups: ReadonlyArray<SceneGroup>;
  readonly applications: ReadonlyArray<ProcessRecipeApplication>;
};
export function materializeProductionSheets(
  prepared: PreparedProductionNest,
  result: ProductionNestResult,
  acceptPartial: boolean,
): ProcessRecipeResult<Project> {
  if (!validateProductionNest(prepared.input, result))
    return invalid(
      'The production draft fails independent quantities, rotations, grain, containment or collision checks.',
    );
  if (result.unplaced > 0 && !acceptPartial)
    return invalid(
      'Review every unplaced quantity and explicitly choose a partial production layout.',
    );
  if (result.produced === 0) return invalid('No requested parts were placed.');
  const project = prepared.project;
  const book = project.sheetBook ?? {
    activeId: 'design-sheet',
    activeName: 'Production design',
    inactive: [],
  };
  if (book.inactive.length + result.sheets.length > 99)
    return invalid(
      'Generated production sheets would exceed this project’s 100-sheet format limit.',
    );
  const inactive = [...book.inactive];
  for (const layout of result.sheets) {
    const stock = prepared.input.definition.sheets.find((sheet) => sheet.id === layout.sheetId);
    if (stock === undefined) return invalid('A production sheet definition is missing.');
    const sheetId = freeSheetId(new Set([book.activeId, ...inactive.map((sheet) => sheet.id)]));
    const generated = materializeProductionSheet(prepared, layout, stock, sheetId);
    const encoded = serializeProject(generated, { compact: true });
    const checked = deserializeProject(encoded);
    if (checked.kind !== 'ok')
      return invalid(
        'Generated sheet ' +
          stock.name +
          ' cannot be reopened: ' +
          (checked.kind === 'invalid' ? checked.reason : checked.kind),
      );
    inactive.push({ id: sheetId, name: stock.name, projectJson: encoded });
  }
  return {
    kind: 'ok',
    value: {
      ...project,
      productionNest: prepared.input.definition,
      sheetBook: { ...book, inactive },
    },
  };
}
function materializeProductionSheet(
  prepared: PreparedProductionNest,
  layout: ProductionNestResult['sheets'][number],
  stock: ProductionNestStock,
  sheetId: string,
): Project {
  const {
    sheetBook: _book,
    productionManifest: _manifest,
    arrayLayouts: _arrays,
    processRecipeApplications: _applications,
    ...project
  } = prepared.project;
  const clones = materializeSheetClones(prepared, layout, sheetId);
  const objects = clones.flatMap((entry) => entry.clone.objects);
  const groups = clones.flatMap((entry) => entry.clone.groups);
  const applications = mergeProductionRecipeApplications(
    clones.flatMap((entry) => entry.clone.applications),
  );
  const machine = productionMachine(project, stock);
  const cncSetup = remapProductionSetup(
    project,
    clones.map((entry) => entry.clone.copied),
  );
  return {
    ...project,
    ...(machine === undefined ? {} : { machine }),
    ...(cncSetup === undefined ? {} : { cncSetup }),
    productionNest: {
      ...prepared.input.definition,
      output: {
        sheetId: stock.id,
        instances: clones.map((entry) => ({
          partId: entry.placement.partId,
          instanceId: entry.placement.id,
          objectIds: entry.clone.objects.map((object) => object.id),
        })),
      },
    },
    jobSetup: {
      ...project.jobSetup,
      outputScope: { cutSelectedGraphics: false, useSelectionOrigin: false, selectedObjectIds: [] },
    },
    processRecipeApplications: applications,
    scene: {
      objects,
      layers: [
        ...project.scene.layers.filter(
          (layer) =>
            layer.cnc?.reliefProjection === undefined ||
            objects.some((object) => sceneObjectUsesOperation(object, layer)),
        ),
        ...clones.flatMap((entry) => entry.clone.layers),
      ],
      groups,
      artworkOrder: objects.map((object) => object.id),
    },
  };
}
function freeSheetId(ids: ReadonlySet<string>): string {
  let count = 1;
  while (ids.has('production-sheet-' + count)) count += 1;
  return 'production-sheet-' + count;
}
function invalid(reason: string): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason };
}
function productionMachine(project: Project, stock: ProductionNestStock): Project['machine'] {
  if (project.machine?.kind !== 'cnc') return project.machine;
  const { materialKey: _oldMaterial, ...previous } = project.machine.stock;
  return {
    ...project.machine,
    stock: {
      ...previous,
      widthMm: stock.widthMm,
      heightMm: stock.heightMm,
      thicknessMm: stock.thicknessMm,
      originOffset: { x: 0, y: 0 },
      ...(isChiploadMaterialKey(stock.materialKey) ? { materialKey: stock.materialKey } : {}),
    },
  };
}

function materializeSheetClones(
  prepared: PreparedProductionNest,
  layout: ProductionNestResult['sheets'][number],
  sheetId: string,
): ReadonlyArray<{
  readonly placement: ProductionNestResult['sheets'][number]['placements'][number];
  readonly clone: ProductionNestApplication;
}> {
  const palette = [...prepared.project.scene.layers];
  return layout.placements.flatMap((placement, index) => {
    const unit = prepared.units.find((unit) => unit.partId === placement.partId);
    if (unit === undefined) return [];
    const clone = materializeProductionPart(
      prepared.project,
      unit,
      placement,
      sheetId + '-c' + (index + 1),
      palette,
    );
    palette.push(...clone.layers);
    return [{ placement, clone }];
  });
}
