import type { Layer, Project, SceneObject } from '../scene';
import type { ProcessRecipe } from './process-recipe';
import type { ProcessRecipeApplication } from './process-recipe-application';
import type { ProcessRecipePreview } from './process-recipe-selectors';
import type { installRecipeTools } from './process-recipe-tools';

export type ApplyRecipeTemplateOptions = {
  readonly applicationId?: string | undefined;
  readonly reviewedSignature?: string | undefined;
  /** Explicitly reviewed replacement; ordinary reapply preserves operator changes. */
  readonly replaceOperatorChanges?: boolean;
};
export type TemplateApplicationContext = {
  readonly project: Project;
  readonly recipe: ProcessRecipe;
  readonly application: ProcessRecipeApplication | undefined;
  readonly ids: ReadonlyArray<string>;
  readonly targets: ReadonlyArray<SceneObject>;
  readonly target: SceneObject;
  readonly preview: ProcessRecipePreview;
  readonly options: ApplyRecipeTemplateOptions;
  readonly order: ReadonlyArray<number>;
  readonly installed: ReturnType<typeof installRecipeTools>;
  readonly layers: Layer[];
};
