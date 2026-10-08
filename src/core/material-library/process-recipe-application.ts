import type { ProcessRecipe, ProcessRecipeStep } from './process-recipe';

/** Application facts are project-owned; deleting a library recipe leaves them usable. */
export type ProcessRecipeApplication = {
  readonly id: string;
  readonly recipe: ProcessRecipe;
  readonly objectIds: ReadonlyArray<string>;
  readonly operations: ReadonlyArray<{
    readonly stepIndex: number;
    readonly operationId: string;
    readonly baseline: ProcessRecipeStep;
  }>;
  readonly bindings: ReadonlyArray<ProcessRecipeBinding>;
};

export type ProcessRecipeBinding = {
  readonly objectId: string;
  readonly operationIds: ReadonlyArray<string>;
  readonly pathOperationIds?: ReadonlyArray<ReadonlyArray<string>> | undefined;
};
