import { z } from 'zod';
import {
  validRegistration,
  type MaterialExperiment,
} from '../../core/material-library/material-experiment';
import {
  canonicalProcessRecipe,
  type ProcessRecipe,
} from '../../core/material-library/process-recipe';
import { parseProcessRecipes } from './process-recipe-io';

export const MAX_EXPERIMENT_PHOTO_CHARS = 1_600_000;
const text = z.string().max(10_000);
const id = z.string().min(1).max(200);
const number = z.number().finite();
const point = z.object({ x: number.min(0).max(1), y: number.min(0).max(1) });
const bounds = z
  .object({ minX: number, minY: number, maxX: number, maxY: number })
  .refine((value) => value.minX <= value.maxX && value.minY <= value.maxY);
const process = z.custom<ProcessRecipe>((value) => parseProcessRecipes([value]).kind === 'ok');
const cell = z.object({
  id,
  row: z.number().int().min(0).max(399),
  column: z.number().int().min(0).max(399),
  objectId: id,
  bounds,
  requestedFeed: number.positive(),
  effectiveFeed: number.positive(),
  process,
  observation: text,
  recipeRef: z.object({ kind: z.enum(['material', 'process']), id, revision: id }).optional(),
});
const photo = z.object({
  dataUrl: z
    .string()
    .max(MAX_EXPERIMENT_PHOTO_CHARS)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
  registration: z.tuple([point, point, point, point]).refine(validRegistration).optional(),
});
const experiment = z
  .object({
    id,
    name: id,
    createdAt: z.string().datetime(),
    source: z.enum(['grid', 'artwork']),
    machineKind: z.enum(['laser', 'cnc']),
    deviceName: id,
    profileId: id.optional(),
    headDescription: text.optional(),
    axes: text.optional(),
    material: z.string().max(200),
    batch: z.string().max(200),
    thicknessMm: number.positive().optional(),
    notes: text,
    cells: z.array(cell).min(1).max(400),
    selectedCellId: id.optional(),
    photo: photo.optional(),
  })
  .superRefine((value, context) => {
    const ids = new Set(value.cells.map((entry) => entry.id));
    if (ids.size !== value.cells.length)
      context.addIssue({ code: 'custom', message: 'Duplicate cell id' });
    if (
      new Set(value.cells.map((entry) => `${entry.row}/${entry.column}`)).size !==
      value.cells.length
    )
      context.addIssue({ code: 'custom', message: 'Duplicate grid position' });
    if (value.selectedCellId !== undefined && !ids.has(value.selectedCellId))
      context.addIssue({ code: 'custom', message: 'Selected cell is missing' });
    if (value.cells.some((entry) => entry.process.machineKind !== value.machineKind))
      context.addIssue({ code: 'custom', message: 'Process belongs to a different machine kind' });
  });

export function parseMaterialExperiments(
  value: unknown,
):
  | { readonly kind: 'ok'; readonly value: ReadonlyArray<MaterialExperiment> }
  | { readonly kind: 'invalid'; readonly reason: string } {
  const parsed = z
    .array(experiment)
    .max(100)
    .safeParse(value ?? []);
  if (!parsed.success)
    return {
      kind: 'invalid',
      reason: `Invalid material experiments: ${parsed.error.issues[0]?.message ?? 'invalid record'}`,
    };
  const items = parsed.data;
  if (new Set(items.map((item) => item.id)).size !== items.length)
    return { kind: 'invalid', reason: 'Duplicate experiment id' };
  const photoChars = items.reduce((sum, item) => sum + (item.photo?.dataUrl.length ?? 0), 0);
  if (photoChars > 3_000_000)
    return {
      kind: 'invalid',
      reason: 'Experiment photos exceed 3 MB. Export/archive experiments in separate libraries.',
    };
  return {
    kind: 'ok',
    value: items.map((item) => canonicalMaterialExperiment(item as MaterialExperiment)),
  };
}

export function canonicalMaterialExperiment(value: MaterialExperiment): MaterialExperiment {
  return {
    ...value,
    cells: value.cells.map((entry) => ({
      ...entry,
      process: canonicalProcessRecipe(entry.process),
    })),
  };
}
