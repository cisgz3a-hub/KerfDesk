import { z } from 'zod';
import type {
  ProcessRecipeRole,
  ProcessRecipeStep,
} from '../../core/material-library/process-recipe';
import { recipeStepOrder } from '../../core/material-library/process-recipe-order';

const label = z.string().trim().min(1).max(200);
const selector = z
  .object({
    geometry: z.enum(['any', 'closed', 'open', 'circular']),
    objectName: label.optional(),
    groupPath: z.array(label).min(1).max(32).optional(),
    objectKind: z.enum(['text', 'shape', 'imported-svg', 'traced-image']).optional(),
  })
  .strict();
const roles = z
  .array(
    z
      .object({
        id: label,
        name: label,
        required: z.boolean(),
        stepIndices: z.array(z.number().int().nonnegative()).min(1).max(256),
        selector,
      })
      .strict(),
  )
  .min(1)
  .max(256);

export function parseRecipeRoles(
  value: unknown,
  stepCount: number,
): ReadonlyArray<ProcessRecipeRole> | null | undefined {
  if (value === undefined) return undefined;
  const parsed = roles.safeParse(value);
  if (!parsed.success || new Set(parsed.data.map((role) => role.id)).size !== parsed.data.length)
    return null;
  if (
    parsed.data.some(
      (role) =>
        new Set(role.stepIndices).size !== role.stepIndices.length ||
        role.stepIndices.some((index) => index >= stepCount),
    )
  )
    return null;
  return parsed.data;
}

export function validRecipeDependencies(steps: ReadonlyArray<ProcessRecipeStep>): boolean {
  return (
    steps.every(
      (step, index) =>
        validStepDependencies(step.dependsOn, steps.length) && !step.dependsOn?.includes(index),
    ) && recipeStepOrder(steps) !== null
  );
}

export function validStepDependencies(
  value: unknown,
  stepCount: number,
): value is ReadonlyArray<number> | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= 256 &&
      new Set(value).size === value.length &&
      value.every(
        (index: unknown) =>
          typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < stepCount,
      ))
  );
}
