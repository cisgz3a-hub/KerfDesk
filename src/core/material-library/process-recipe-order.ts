import type { ProcessRecipeStep } from './process-recipe';

/** Stable topological order, retaining recipe order between independent steps. */
export function recipeStepOrder(steps: ReadonlyArray<ProcessRecipeStep>): number[] | null {
  const remaining = new Set(steps.map((_, index) => index));
  const ordered: number[] = [];
  while (remaining.size > 0) {
    const next = [...remaining].find((index) =>
      (steps[index]?.dependsOn ?? []).every((dependency) => ordered.includes(dependency)),
    );
    if (next === undefined) return null;
    remaining.delete(next);
    ordered.push(next);
  }
  return ordered;
}
