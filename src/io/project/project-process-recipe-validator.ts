import { z } from 'zod';
import type { ProcessRecipeApplication } from '../../core/material-library/process-recipe-application';
import type { ProcessRecipeResult } from '../../core/material-library/process-recipe';
import { parseProcessRecipe, parseProcessRecipeStep } from '../material-library/process-recipe-io';
import { validStepDependencies } from '../material-library/process-recipe-selectors-io';

const id = z.string().min(1).max(200);
const ids = z.array(id).max(10_000);
const applications = z
  .array(
    z
      .object({
        id,
        recipe: z.unknown(),
        objectIds: ids.min(1),
        operations: z
          .array(
            z
              .object({
                stepIndex: z.number().int().nonnegative().max(255),
                operationId: id,
                baseline: z.unknown(),
              })
              .strict(),
          )
          .max(256),
        bindings: z
          .array(
            z
              .object({
                objectId: id,
                operationIds: z.array(id).max(256),
                pathOperationIds: z.array(z.array(id).max(256)).max(100_000).optional(),
              })
              .strict(),
          )
          .max(10_000),
      })
      .strict(),
  )
  .max(32);

export function parseProcessRecipeApplications(
  value: unknown,
): ProcessRecipeResult<ReadonlyArray<ProcessRecipeApplication>> {
  if (value === undefined) return { kind: 'ok', value: [] };
  const parsed = applications.safeParse(value);
  if (!parsed.success) return invalid('Invalid retained machining template applications');
  if (!unique(parsed.data.map((item) => item.id)))
    return invalid('Duplicate machining template application identity');
  const result: ProcessRecipeApplication[] = [];
  let paths = 0;
  for (const raw of parsed.data) {
    paths += raw.bindings.reduce(
      (count, binding) => count + (binding.pathOperationIds?.length ?? 0),
      0,
    );
    if (paths > 100_000)
      return invalid('Retained machining template bindings exceed 100000 path groups');
    const application = parseApplication(raw);
    if (application.kind === 'invalid') return application;
    result.push(application.value);
  }
  return { kind: 'ok', value: result };
}

/** Project validation can keep missing artwork/operations for an explicit reapply preview. */
export function validateProcessRecipeApplications(value: unknown): string | null {
  const parsed = parseProcessRecipeApplications(value);
  return parsed.kind === 'invalid' ? parsed.reason : null;
}
function unique(values: ReadonlyArray<string | number>): boolean {
  return new Set(values).size === values.length;
}
function invalid(reason: string): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason };
}

type ApplicationInput = z.infer<typeof applications>[number];
function parseApplication(raw: ApplicationInput): ProcessRecipeResult<ProcessRecipeApplication> {
  const recipe = parseProcessRecipe(raw.recipe);
  if (recipe.kind === 'invalid' || recipe.value.roles === undefined)
    return invalid('Invalid retained machining template recipe');
  const bindingError = bindingProblem(raw);
  if (bindingError !== null) return invalid(bindingError);
  const operations: ProcessRecipeApplication['operations'][number][] = [];
  for (const operation of raw.operations) {
    const baseline = parseProcessRecipeStep(operation.baseline, recipe.value.machineKind);
    if (
      operation.stepIndex >= recipe.value.steps.length ||
      baseline.kind === 'invalid' ||
      !validStepDependencies(baseline.value.dependsOn, recipe.value.steps.length)
    )
      return invalid('Invalid retained template operation snapshot');
    operations.push({
      stepIndex: operation.stepIndex,
      operationId: operation.operationId,
      baseline: baseline.value,
    });
  }

  return { kind: 'ok', value: { ...raw, recipe: recipe.value, operations } };
}

function bindingProblem(raw: ApplicationInput): string | null {
  if (
    !unique(raw.objectIds) ||
    !unique(raw.operations.map((operation) => operation.stepIndex)) ||
    !unique(raw.operations.map((operation) => operation.operationId)) ||
    !unique(raw.bindings.map((binding) => binding.objectId))
  )
    return 'Duplicate retained template binding identity';
  if (
    raw.bindings.some(
      (binding) =>
        !raw.objectIds.includes(binding.objectId) ||
        !unique(binding.operationIds) ||
        binding.pathOperationIds?.some((entry) => !unique(entry)),
    )
  )
    return 'Invalid retained template artwork binding';
  return null;
}
