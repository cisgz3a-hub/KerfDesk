import { z } from 'zod';
import type { ProductionNestDefinition } from '../../core/nesting/production-nest';
import type { ProcessRecipeResult } from '../../core/material-library/process-recipe';

const label = z.string().min(1).max(200);
const finitePositive = z.number().finite().positive();
const grain = z.enum(['none', 'x', 'y']);
const definition = z
  .object({
    id: label,
    name: label,
    parts: z
      .array(
        z
          .object({
            id: label,
            name: label,
            objectIds: z.array(label).min(1).max(10_000),
            quantity: z.number().int().min(1).max(10_000),
            materialKey: label,
            thicknessMm: finitePositive,
            rotationAngles: z
              .array(z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]))
              .min(1)
              .max(4),
            grain,
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    sheets: z
      .array(
        z
          .object({
            id: label,
            name: label,
            stockId: label,
            kind: z.enum(['sheet', 'remnant']),
            materialKey: label,
            thicknessMm: finitePositive,
            widthMm: finitePositive,
            heightMm: finitePositive,
            grain,
          })
          .strict(),
      )
      .min(1)
      .max(99),
    padding: z.number().finite().nonnegative(),
    goal: z.enum(['tidy', 'compact', 'grid']),
    method: z.enum(['fast', 'outline']),
    optimise: z.boolean(),
    output: z
      .object({
        sheetId: label,
        instances: z
          .array(
            z
              .object({
                partId: label,
                instanceId: label,
                objectIds: z.array(label).min(1).max(10_000),
              })
              .strict(),
          )
          .max(10_000),
      })
      .strict()
      .optional(),
  })
  .strict();

export function parseProductionNestDefinition(
  value: unknown,
): ProcessRecipeResult<ProductionNestDefinition | undefined> {
  if (value === undefined) return { kind: 'ok', value: undefined };
  const parsed = definition.safeParse(value);
  if (!parsed.success) return invalid('Invalid quantity nesting definition');
  const data = parsed.data;
  if (!unique(data.parts.map((part) => part.id)) || !unique(data.sheets.map((sheet) => sheet.id)))
    return invalid('Duplicate production part or sheet identity');
  if (data.parts.reduce((count, part) => count + part.quantity, 0) > 10_000)
    return invalid('Quantity nesting exceeds 10000 requested copies');
  if (
    data.parts.some((part) => !unique(part.objectIds) || !unique(part.rotationAngles.map(String)))
  )
    return invalid('Duplicate attached artwork or permitted turn');
  if (data.output !== undefined && !validOutput(data.output, data))
    return invalid('Invalid generated quantity sheet provenance');
  return {
    kind: 'ok',
    value: { ...data, ...(data.output === undefined ? {} : { output: data.output }) },
  };
}
export function validateProductionNestDefinition(value: unknown): string | null {
  const result = parseProductionNestDefinition(value);
  return result.kind === 'invalid' ? result.reason : null;
}
function validOutput(
  output: NonNullable<ProductionNestDefinition['output']>,
  data: ProductionNestDefinition,
): boolean {
  const parts = new Set(data.parts.map((part) => part.id));
  return (
    data.sheets.some((sheet) => sheet.id === output.sheetId) &&
    unique(output.instances.map((instance) => instance.instanceId)) &&
    unique(output.instances.flatMap((instance) => instance.objectIds)) &&
    output.instances.every((instance) => parts.has(instance.partId))
  );
}
function unique(value: ReadonlyArray<string>): boolean {
  return new Set(value).size === value.length;
}
function invalid(reason: string): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason };
}
