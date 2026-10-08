import type {
  ConstrainedSketch2d,
  SketchSolveResult,
} from '../../core/sketch-constraints/constrained-sketch';
import {
  materializeConstrainedSketch,
  sketchGeometryMatches,
} from '../../core/sketch-constraints/materialize-constrained-sketch';
import {
  operationIdsForObject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type ColoredPath,
  type Bounds,
} from '../../core/scene';
import { DEFAULT_TEXT_COLOR } from '../../core/text/text-object';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import { prepareDimensionedVector } from './prepare-dimensioned-vector';
import { sceneLimitOverrun } from './scene-copy-room';
import { retainSketchTabBindings, retainSketchRecipeBindings } from './constrained-sketch-bindings';
export type ConstrainedSketchReview = {
  readonly sourceProject: Project;
  readonly nextProject: Project;
  readonly documentEpoch: number;
  readonly sourceObject: ImportedSvg | null;
  readonly object: ImportedSvg;
  readonly result: Extract<SketchSolveResult, { kind: 'solved' }>;
  readonly replacesManualGeometry: boolean;
  readonly affectedOperationIds: readonly string[];
};
export type ConstrainedSketchReviewResult =
  | { readonly kind: 'ok'; readonly review: ConstrainedSketchReview }
  | { readonly kind: 'invalid'; readonly reason: string; readonly result?: SketchSolveResult };
export type ConstrainedSketchActions = {
  readonly reviewConstrainedSketch: (
    sketch: ConstrainedSketch2d,
    objectId?: string,
  ) => ConstrainedSketchReviewResult;
  readonly applyConstrainedSketch: (review: ConstrainedSketchReview) => boolean;
  readonly bakeConstrainedSketch: (object: ImportedSvg, epoch: number) => boolean;
};
type Setter = (fn: (state: AppState) => Partial<AppState>) => void;
export function constrainedSketchActions(
  set: Setter,
  get: () => AppState,
): ConstrainedSketchActions {
  const owned = new WeakMap<ConstrainedSketchReview, Project>();
  return {
    reviewConstrainedSketch: (sketch, objectId) => {
      const result = prepareSketchReview(get(), sketch, objectId);
      if (result.kind === 'ok') owned.set(result.review, result.review.nextProject);
      return result;
    },
    applyConstrainedSketch: (review) => {
      if (owned.get(review) !== review.nextProject || !ownsReview(get(), review)) return false;
      owned.delete(review);
      let applied = false;
      set((state) => {
        if (!ownsReview(state, review)) return {};
        applied = true;
        return {
          project: review.nextProject,
          selectedObjectId: review.object.id,
          additionalSelectedIds: new Set<string>(),
          undoStack: pushUndo(
            state.project,
            state.undoStack,
            'Apply constrained sketch dimensions',
          ),
          redoStack: [],
          dirty: true,
        };
      });
      return applied;
    },
    bakeConstrainedSketch: (object, epoch) => bakeSketch(set, object, epoch),
  };
}
function prepareSketchReview(
  state: AppState,
  sketch: ConstrainedSketch2d,
  objectId: string | undefined,
): ConstrainedSketchReviewResult {
  const selected = sketchSource(state.project, objectId);
  if (selected.kind === 'invalid') return selected;
  const source = selected.source;
  const built = solvedSketchGeometry(sketch, source);
  if (built.kind === 'invalid') return built;
  const generated = retainSketchTabBindings(
    source,
    {
      ...(source ?? {
        kind: 'imported-svg' as const,
        id: crypto.randomUUID(),
        source: 'Constrained sketch',
        name: sketch.name,
        transform: IDENTITY_TRANSFORM,
      }),
      paths: built.paths,
      bounds: built.bounds,
      constrainedSketch: built.result.sketch,
    },
    built.previousPathKeys,
  );
  const staged =
    source === null
      ? prepareDimensionedVector(state, generated)
      : { object: generated, project: replaceSketch(state.project, source, generated) };
  const error = sceneLimitOverrun(
    state.project.scene,
    staged.project.scene,
    'Delete artwork or operations before creating another sketch.',
  );
  if (error !== null) return { kind: 'invalid', reason: error };
  return {
    kind: 'ok',
    review: {
      sourceProject: state.project,
      nextProject: staged.project,
      documentEpoch: state.projectDocumentEpoch,
      sourceObject: source,
      object: staged.object,
      result: built.result,
      replacesManualGeometry: source !== null && !sketchGeometryMatches(source),
      affectedOperationIds: operationIdsForObject(staged.object, staged.project.scene.layers),
    },
  };
}
function sketchSource(
  project: Project,
  objectId: string | undefined,
):
  | { readonly kind: 'ok'; readonly source: ImportedSvg | null }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (objectId === undefined) return { kind: 'ok', source: null };
  const source = project.scene.objects.find((object) => object.id === objectId);
  if (source?.kind !== 'imported-svg')
    return { kind: 'invalid', reason: 'Choose a vector sketch in the current project.' };
  if (source.partGenerator !== undefined || source.booleanCompound !== undefined)
    return {
      kind: 'invalid',
      reason: 'Bake this retained geometry source before attaching a sketch source.',
    };
  if (source.locked === true)
    return { kind: 'invalid', reason: 'Unlock the sketch before editing dimensions.' };
  return { kind: 'ok', source };
}
function ownsReview(state: AppState, review: ConstrainedSketchReview): boolean {
  return (
    state.project === review.sourceProject && state.projectDocumentEpoch === review.documentEpoch
  );
}
function replaceSketch(project: Project, before: ImportedSvg, after: ImportedSvg): Project {
  const applications = retainSketchRecipeBindings(project, before, after);
  return {
    ...project,
    ...(applications === undefined ? {} : { processRecipeApplications: applications }),
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) => (object === before ? after : object)),
    },
  };
}
function bakeSketch(set: Setter, object: ImportedSvg, epoch: number): boolean {
  let applied = false;
  set((state) => {
    if (
      state.projectDocumentEpoch !== epoch ||
      !state.project.scene.objects.includes(object) ||
      object.constrainedSketch === undefined ||
      object.locked === true
    )
      return {};
    const { constrainedSketch: _source, ...baked } = object;
    applied = true;
    return {
      project: replaceSketch(state.project, object, baked),
      undoStack: pushUndo(state.project, state.undoStack, 'Bake constrained sketch'),
      redoStack: [],
      dirty: true,
    };
  });
  return applied;
}

function solvedSketchGeometry(
  sketch: ConstrainedSketch2d,
  source: ImportedSvg | null,
):
  | {
      readonly kind: 'ok';
      readonly paths: readonly ColoredPath[];
      readonly bounds: Bounds;
      readonly previousPathKeys: readonly string[];
      readonly result: Extract<SketchSolveResult, { readonly kind: 'solved' }>;
    }
  | Extract<ConstrainedSketchReviewResult, { readonly kind: 'invalid' }> {
  const built = materializeConstrainedSketch(
    sketch,
    source?.paths[0]?.color ?? DEFAULT_TEXT_COLOR,
    source ?? undefined,
  );
  if (
    built.result.kind !== 'solved' ||
    built.result.status === 'over-constrained' ||
    built.paths === undefined ||
    built.bounds === undefined
  )
    return {
      kind: 'invalid',
      reason:
        built.result.kind === 'invalid'
          ? built.result.reason
          : 'Conflicting dimensions remain. Resolve the named constraints before applying.',
      result: built.result,
    };
  return {
    kind: 'ok',
    paths: built.paths,
    bounds: built.bounds,
    result: built.result,
    previousPathKeys: built.previousPathKeys ?? [],
  };
}
