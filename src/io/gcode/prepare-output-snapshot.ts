import { isBarcodeObject } from '../../core/barcode';
import type { PreflightResult } from '../../core/preflight';
import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  sceneObjectUsesOperation,
  type Bounds,
  type ColoredPath,
  type Project,
  type TextObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { evaluateVariableTemplate, type VariableEvaluationContext } from '../../core/variables';
import { applySimilarityProject, type SimilarityTransform } from '../../core/registration';
import { prepareOutput, type PreparedOutput, type PrepareOutputOptions } from './prepare-output';
import { materializeVariableBarcode } from './materialize-variable-barcode';
import { anchoredVariableTextTransform } from './variable-text-anchor';
import {
  asksRightToLeftOnSingleLine,
  mergeTextNotices,
  plainTextGlyphAdvisory,
  rightToLeftAdvisory,
  variableRecordGlyphAdvisory,
  variableRecordOverflowAdvisory,
  type TextNotice,
} from './text-glyph-advisory';

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
  // How far the record's ink passes its frame: output warns (ADR-682 Amendment 2).
  readonly frameOverflowMm?: number;
};
export type VariableTextRenderer = {
  (input: VariableTextRenderInput): Promise<VariableTextRenderResult>;
  /**
   * The characters `content` engraves that the text's font has no glyph for, as its render would
   * report them, without laying it out. Output checks plain text with it (ADR-591 Amendment 2); a
   * renderer without it leaves plain text unchecked.
   */
  readonly missingCharacters?: (input: VariableTextRenderInput) => Promise<ReadonlyArray<string>>;
};

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

const OLDER_GEOMETRY_TOLERANCE_MM = 0.01;

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
  return { ...withTextAdvisories(prepared, evaluated.advisories), evaluationContext };
}

/**
 * Output compiled without a snapshot has no records to evaluate, yet still names each burned plain
 * text's missing characters, as a snapshot's preparation does (ADR-591 Amendment 2).
 */
export async function withTextGlyphCheck(
  prepared: PreparedOutput,
  project: Project,
  renderer: VariableTextRenderer,
): Promise<PreparedOutput> {
  if (!prepared.ok) return prepared;
  const advisories: TextAdvisory[] = [];
  for (const object of project.scene.objects) {
    if (object.kind !== 'text' || object.variableTemplate !== undefined) continue;
    for (const issue of await plainTextNotices(object, project, renderer))
      advisories.push({ objectId: object.id, issue });
  }
  return withTextAdvisories(prepared, advisories);
}

// What a text's font or frame does to it informs Job Review, Start and Save; it never refuses
// output. Only text this output burns counts: inside its scope and on an output layer. The merged
// notices come first, so a route that toasts in order leaves the newest place to its other checks.
function withTextAdvisories(
  prepared: PreparedOutput,
  advisories: ReadonlyArray<TextAdvisory>,
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
  return { ...prepared, advisories: [...mergeTextNotices(issues), ...(prepared.advisories ?? [])] };
}

/**
 * The warnings a set of texts raises, one per kind however many texts: an export or a print says
 * them where output would (ADR-591 Amendment 3).
 */
export function textAdvisoryWarnings(
  advisories: ReadonlyArray<TextAdvisory>,
): ReadonlyArray<string> {
  return mergeTextNotices(advisories.map((advisory) => advisory.issue)).map(
    (issue) => issue.message,
  );
}

/** What a text's font or frame does to its burn (ADR-591 Amendments 1 to 3, ADR-682 Amendment 2). */
export type TextAdvisory = { readonly objectId: string; readonly issue: TextNotice };

type MaterializedProject =
  | {
      readonly ok: true;
      readonly project: Project;
      readonly advisories: ReadonlyArray<TextAdvisory>;
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
      result.ok
        ? (result.notices ?? []).map((issue) => ({ objectId: result.object.id, issue }))
        : [],
    ),
  };
}

export type MaterializedObject =
  | {
      readonly ok: true;
      readonly object: Project['scene']['objects'][number];
      readonly notices?: ReadonlyArray<TextNotice>;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly fallback: Project['scene']['objects'][number];
    };

/**
 * One object with its variable text or barcode data evaluated into plain content. Plain text stays
 * as it is, with what its font does to it when the renderer can check that.
 */
export async function materializeVariableObject(
  object: Project['scene']['objects'][number],
  project: Project,
  context: VariableEvaluationContext,
  renderer: VariableTextRenderer,
): Promise<MaterializedObject> {
  if (isBarcodeObject(object))
    return materializeVariableBarcode(object, project, context, renderer);
  if (object.kind !== 'text') return { ok: true, object };
  if (object.variableTemplate === undefined) {
    const notices = await plainTextNotices(object, project, renderer);
    return { ok: true, object, ...(notices.length === 0 ? {} : { notices }) };
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
    const notices = [
      variableRecordGlyphAdvisory(
        object,
        object.variableTemplate,
        { value: evaluated.value, missing: rendered.missingCharacters ?? [] },
        project,
        context,
      ),
      variableRecordOverflowAdvisory(
        object.variableTemplate,
        { value: evaluated.value, overflowMm: rendered.frameOverflowMm },
        project,
        context,
      ),
      asksRightToLeftOnSingleLine(object)
        ? rightToLeftAdvisory(object, evaluated.value, project)
        : undefined,
    ].filter((notice) => notice !== undefined);
    return {
      ok: true,
      ...(notices.length === 0 ? {} : { notices }),
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

/**
 * What a plain text's font does to it: the characters it has no glyph for, which its stored
 * geometry already lacks (ADR-591 Amendment 2), and a Right-to-left it cannot lay out (Amendment
 * 3). The check never refuses output: a text it cannot check (a font that will not load) burns as
 * before. `where` names the text's place, such as a production row.
 */
export async function plainTextNotices(
  text: TextObject,
  project: Project,
  renderer: VariableTextRenderer,
  where?: string,
): Promise<ReadonlyArray<TextNotice>> {
  const check = renderer.missingCharacters;
  if (check === undefined) return [];
  const missing = await check({ text, content: text.content, project }).catch(
    (): ReadonlyArray<string> => [],
  );
  const glyphs = plainTextGlyphAdvisory(text, missing, project, where);
  return [
    ...(glyphs === undefined ? [] : [glyphs]),
    ...(asksRightToLeftOnSingleLine(text)
      ? [
          rightToLeftAdvisory(
            text,
            text.content,
            project,
            await holdsOlderBidiMarks(text, project, renderer),
            where,
          ),
        ]
      : []),
  ];
}

// Plain text burns its stored geometry. An older build drew each bidi mark as a ?, so that
// geometry is wider than the same text drawn now. Path text is placed in world space and has no
// such comparison, so it is not called out.
async function holdsOlderBidiMarks(
  text: TextObject,
  project: Project,
  renderer: VariableTextRenderer,
): Promise<boolean> {
  if (text.pathText !== undefined) return false;
  const fresh = await renderer({ text, content: text.content, project }).catch(() => undefined);
  if (fresh === undefined) return false;
  const width = (bounds: Bounds): number => bounds.maxX - bounds.minX;
  return Math.abs(width(fresh.bounds) - width(text.bounds)) > OLDER_GEOMETRY_TOLERANCE_MM;
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
