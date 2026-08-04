import type { PreflightResult } from '../../core/preflight';
import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  type Bounds,
  type ColoredPath,
  type Project,
  type TextObject,
  type Transform,
} from '../../core/scene';
import { evaluateVariableTemplate, type VariableEvaluationContext } from '../../core/variables';
import { applySimilarityProject, type SimilarityTransform } from '../../core/registration';
import { prepareOutput, type PreparedOutput, type PrepareOutputOptions } from './prepare-output';

export type VariableTextRenderInput = {
  readonly text: TextObject;
  readonly content: string;
  readonly project: Project;
};
export type VariableTextRenderResult = {
  readonly bounds: Bounds;
  readonly paths: readonly ColoredPath[];
  readonly transform?: Transform;
};
export type VariableTextRenderer = (
  input: VariableTextRenderInput,
) => Promise<VariableTextRenderResult>;

export type PrepareOutputSnapshotOptions = PrepareOutputOptions & {
  readonly clock: () => Date;
  readonly recordIndex?: number;
  readonly serialValue?: number;
  readonly renderVariableText: VariableTextRenderer;
  readonly registration?: SimilarityTransform | null;
  /** Worker-owned compile seam. Heavy callers pass prepareOutputAsync here;
   * browser-thread callers retain the synchronous core fast path. */
  readonly prepare?: (
    project: Project,
    options: PrepareOutputOptions,
  ) => PreparedOutput | Promise<PreparedOutput>;
};

export type PreparedOutputSnapshot = PreparedOutput & {
  readonly evaluationContext: VariableEvaluationContext;
};

export const PRINT_CUT_REGISTRATION_INVALID_MESSAGE =
  'Print-and-Cut registration is not valid. Capture both machine points again.';

const rendererCaches = new WeakMap<
  VariableTextRenderer,
  WeakMap<Project, Map<string, Promise<PreparedOutputSnapshot>>>
>();

export function prepareOutputSnapshot(
  project: Project,
  options: PrepareOutputSnapshotOptions,
): Promise<PreparedOutputSnapshot> {
  const evaluationContext = resolveEvaluationContext(project, options);
  const registrationFailure = validateRegistrationOptions(options);
  if (registrationFailure !== null) {
    return Promise.resolve({ ...registrationFailure, evaluationContext });
  }
  const cache = projectCache(options.renderVariableText, project);
  const key = snapshotCacheKey(options, evaluationContext);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const prepared = prepareSnapshot(project, options, evaluationContext);
  cache.set(key, prepared);
  return prepared;
}

function validateRegistrationOptions(
  options: PrepareOutputSnapshotOptions,
): Extract<PreparedOutput, { readonly ok: false }> | null {
  if (options.registration === null) {
    return snapshotFailure(
      'print-and-cut-registration-invalid',
      PRINT_CUT_REGISTRATION_INVALID_MESSAGE,
    );
  }
  return null;
}

async function prepareSnapshot(
  project: Project,
  options: PrepareOutputSnapshotOptions,
  evaluationContext: VariableEvaluationContext,
): Promise<PreparedOutputSnapshot> {
  const evaluated = await materializeVariableText(
    project,
    evaluationContext,
    options.renderVariableText,
  );
  if (!evaluated.ok) return { ...evaluated, evaluationContext };
  const registeredProject =
    options.registration === undefined || options.registration === null
      ? evaluated.project
      : applySimilarityProject(evaluated.project, options.registration);
  const prepared = await (options.prepare ?? prepareOutput)(
    registeredProject,
    outputOptions(options),
  );
  return { ...prepared, evaluationContext };
}

type MaterializedProject =
  | { readonly ok: true; readonly project: Project }
  | { readonly ok: false; readonly preflight: PreflightResult };

async function materializeVariableText(
  project: Project,
  context: VariableEvaluationContext,
  renderer: VariableTextRenderer,
): Promise<MaterializedProject> {
  const objects: MaterializedObject[] = [];
  for (const object of project.scene.objects) {
    objects.push(await materializeObject(object, project, context, renderer));
  }
  const failed = objects.find((result) => !result.ok);
  if (failed !== undefined && !failed.ok) return variableFailure(failed.message);
  return {
    ok: true,
    project: {
      ...project,
      scene: {
        ...project.scene,
        objects: objects.map((result) => (result.ok ? result.object : result.fallback)),
      },
    },
  };
}

type MaterializedObject =
  | { readonly ok: true; readonly object: Project['scene']['objects'][number] }
  | {
      readonly ok: false;
      readonly message: string;
      readonly fallback: Project['scene']['objects'][number];
    };

async function materializeObject(
  object: Project['scene']['objects'][number],
  project: Project,
  context: VariableEvaluationContext,
  renderer: VariableTextRenderer,
): Promise<MaterializedObject> {
  if (object.kind !== 'text' || object.variableTemplate === undefined) {
    return { ok: true, object };
  }
  const evaluated = evaluateVariableTemplate(object.variableTemplate, object, project, context);
  if (!evaluated.ok) return { ...evaluated, fallback: object };
  try {
    const rendered = await renderer({ text: object, content: evaluated.value, project });
    const { variableTemplate: _template, ...plainText } = object;
    return {
      ok: true,
      object: { ...plainText, content: evaluated.value, ...rendered },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Variable text ${object.id} could not render: ${message}`,
      fallback: object,
    };
  }
}

function resolveEvaluationContext(
  project: Project,
  options: PrepareOutputSnapshotOptions,
): VariableEvaluationContext {
  const variables = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  return {
    now: options.clock(),
    recordIndex: options.recordIndex ?? variables.recordIndex,
    serialValue: options.serialValue ?? variables.serialValue,
  };
}

function outputOptions(options: PrepareOutputSnapshotOptions): PrepareOutputOptions {
  return {
    ...(options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin }),
    ...(options.outputScope === undefined ? {} : { outputScope: options.outputScope }),
  };
}

function projectCache(
  renderer: VariableTextRenderer,
  project: Project,
): Map<string, Promise<PreparedOutputSnapshot>> {
  let byProject = rendererCaches.get(renderer);
  if (byProject === undefined) {
    byProject = new WeakMap();
    rendererCaches.set(renderer, byProject);
  }
  let cache = byProject.get(project);
  if (cache === undefined) {
    cache = new Map();
    byProject.set(project, cache);
  }
  return cache;
}

function snapshotCacheKey(
  options: PrepareOutputSnapshotOptions,
  context: VariableEvaluationContext,
): string {
  return JSON.stringify({
    now: context.now.toISOString(),
    recordIndex: context.recordIndex,
    serialValue: context.serialValue,
    jobOrigin: options.jobOrigin ?? null,
    outputScope: options.outputScope ?? null,
    registration: options.registration ?? null,
  });
}

function variableFailure(message: string): Extract<MaterializedProject, { readonly ok: false }> {
  return {
    ok: false,
    preflight: { ok: false, issues: [{ code: 'variable-evaluation-failed', message }] },
  };
}

function snapshotFailure(
  code: 'print-and-cut-registration-invalid',
  message: string,
): Extract<PreparedOutput, { readonly ok: false }> {
  return { ok: false, preflight: { ok: false, issues: [{ code, message }] } };
}
