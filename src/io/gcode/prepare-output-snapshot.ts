import { isBarcodeObject } from '../../core/barcode';
import type { PreflightIssue, PreflightResult } from '../../core/preflight';
import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  sceneObjectUsesOperation,
  type Bounds,
  type ColoredPath,
  type Project,
  type TextObject,
  type Transform,
  type VariableTemplate,
  type Vec2,
} from '../../core/scene';
import {
  evaluateVariableTemplate,
  variableTemplateCsvRecord,
  type VariableEvaluationContext,
} from '../../core/variables';
import { fontDisplayName, missingCharactersSentence } from '../../core/text/missing-glyph-words';
import { applySimilarityProject, type SimilarityTransform } from '../../core/registration';
import { prepareOutput, type PreparedOutput, type PrepareOutputOptions } from './prepare-output';
import { materializeVariableBarcode } from './materialize-variable-barcode';
import { anchoredVariableTextTransform } from './variable-text-anchor';

export type VariableTextRenderInput = {
  readonly text: TextObject;
  readonly content: string;
  readonly project: Project;
};
export type VariableTextRenderResult = {
  readonly bounds: Bounds;
  readonly paths: readonly ColoredPath[];
  readonly transform?: Transform;
  // The render's alignment anchor (see TextRenderResult); output keeps it
  // where the placed text had its anchor. Unused when a transform is given.
  readonly anchor?: Vec2;
  // Characters the font has no glyph for: output warns about them (ADR-591 Amendment 1).
  readonly missingCharacters?: ReadonlyArray<string>;
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
  return { ...withVariableAdvisories(prepared, evaluated.advisories), evaluationContext };
}

/**
 * The advisories only the snapshot knows: a variable record's missing characters. Start and Save
 * re-run the project's preflight when they emit, which cannot see evaluated records, so they add
 * these to their warnings (ADR-591 Amendment 1).
 */
export function variableRecordAdvisories(prepared: PreparedOutput): ReadonlyArray<string> {
  if (!prepared.ok) return [];
  return (prepared.advisories ?? []).flatMap((issue) =>
    issue.code === 'variable-text-missing-glyphs' ? [issue.message] : [],
  );
}

// A record's missing characters inform Job Review, Start and Save; they never refuse output.
// Only text this output burns counts: inside its scope and on an output layer.
function withVariableAdvisories(
  prepared: PreparedOutput,
  advisories: ReadonlyArray<VariableRecordAdvisory>,
): PreparedOutput {
  if (!prepared.ok || advisories.length === 0) return prepared;
  const { objects, layers } = prepared.project.scene;
  const output = layers.filter((layer) => layer.output);
  const burned = new Set(
    objects
      .filter((object) => output.some((layer) => sceneObjectUsesOperation(object, layer)))
      .map((object) => object.id),
  );
  const issues = advisories.flatMap((advisory) =>
    burned.has(advisory.objectId) ? [advisory.issue] : [],
  );
  if (issues.length === 0) return prepared;
  return { ...prepared, advisories: [...(prepared.advisories ?? []), ...issues] };
}

/** A variable record's characters its font has no glyph for (ADR-591 Amendment 1). */
export type VariableRecordAdvisory = { readonly objectId: string; readonly issue: PreflightIssue };

type MaterializedProject =
  | {
      readonly ok: true;
      readonly project: Project;
      readonly advisories: ReadonlyArray<VariableRecordAdvisory>;
    }
  | { readonly ok: false; readonly preflight: PreflightResult };

export async function materializeVariableText(
  project: Project,
  context: VariableEvaluationContext,
  renderer: VariableTextRenderer,
): Promise<MaterializedProject> {
  const objects: MaterializedObject[] = [];
  for (const object of project.scene.objects) {
    objects.push(await materializeVariableObject(object, project, context, renderer));
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
    advisories: objects.flatMap((result) =>
      result.ok && result.advisory !== undefined
        ? [{ objectId: result.object.id, issue: result.advisory }]
        : [],
    ),
  };
}

export type MaterializedObject =
  | {
      readonly ok: true;
      readonly object: Project['scene']['objects'][number];
      readonly advisory?: PreflightIssue;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly fallback: Project['scene']['objects'][number];
    };

/** One object with its variable text or barcode data evaluated into plain content. */
export async function materializeVariableObject(
  object: Project['scene']['objects'][number],
  project: Project,
  context: VariableEvaluationContext,
  renderer: VariableTextRenderer,
): Promise<MaterializedObject> {
  if (isBarcodeObject(object))
    return materializeVariableBarcode(object, project, context, renderer);
  if (object.kind !== 'text' || object.variableTemplate === undefined) {
    return { ok: true, object };
  }
  const evaluated = evaluateVariableTemplate(object.variableTemplate, object, project, context);
  if (!evaluated.ok) return { ...evaluated, fallback: object };
  try {
    const rendered = await renderer({ text: object, content: evaluated.value, project });
    const transform =
      rendered.transform ??
      (await anchoredVariableTextTransform(
        object,
        { content: evaluated.value, anchor: rendered.anchor, bounds: rendered.bounds },
        project,
        renderer,
      ));
    const { variableTemplate: _template, ...plainText } = object;
    const advisory = missingGlyphAdvisory(
      object,
      object.variableTemplate,
      { value: evaluated.value, missing: rendered.missingCharacters ?? [] },
      project,
      context,
    );
    return {
      ok: true,
      ...(advisory === undefined ? {} : { advisory }),
      // Only geometry crosses over: render notes such as the anchor stay off
      // the scene object, which array copies persist.
      object: {
        ...plainText,
        content: evaluated.value,
        bounds: rendered.bounds,
        transform,
        paths: rendered.paths.map((path, index) => {
          // Legacy text and copied text can own operations on their render batch.
          const operationIds = object.paths[index]?.operationIds;
          return operationIds === undefined ? path : { ...path, operationIds };
        }),
      },
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

const EXCERPT_LENGTH = 40;

/** "Variable text “Zoë 李” (CSV record 3): Pacifico has no 李; each engraves as …" */
function missingGlyphAdvisory(
  text: TextObject,
  template: VariableTemplate,
  record: { readonly value: string; readonly missing: ReadonlyArray<string> },
  project: Project,
  context: VariableEvaluationContext,
): PreflightIssue | undefined {
  const { value, missing } = record;
  if (missing.length === 0) return undefined;
  const characters = [...value.replace(/\s+/g, ' ').trim()];
  const excerpt =
    characters.length > EXCERPT_LENGTH
      ? `${characters.slice(0, EXCERPT_LENGTH - 1).join('')}…`
      : characters.join('');
  const csvRecord = variableTemplateCsvRecord(template, project, context);
  const font = fontDisplayName(text.fontKey, project.embeddedFonts);
  return {
    code: 'variable-text-missing-glyphs',
    message:
      `Variable text “${excerpt}”${csvRecord === null ? '' : ` (CSV record ${csvRecord})`}: ` +
      missingCharactersSentence(font, missing, text.fontKey),
  };
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
    ...(options.laserMaxPowerS === undefined ? {} : { laserMaxPowerS: options.laserMaxPowerS }),
    ...(options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin }),
    ...(options.outputScope === undefined ? {} : { outputScope: options.outputScope }),
    ...(options.contourEntryBounds === undefined
      ? {}
      : { contourEntryBounds: options.contourEntryBounds }),
    ...(options.absoluteProgramOffset === undefined
      ? {}
      : { absoluteProgramOffset: options.absoluteProgramOffset }),
    ...(options.workZeroBedPosition === undefined
      ? {}
      : { workZeroBedPosition: options.workZeroBedPosition }),
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
    contourEntryBounds: options.contourEntryBounds,
    absoluteProgramOffset: options.absoluteProgramOffset,
    workZeroBedPosition: options.workZeroBedPosition,
    laserMaxPowerS: options.laserMaxPowerS,
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
