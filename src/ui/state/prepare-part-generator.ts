import {
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type Project,
  type Transform,
} from '../../core/scene';
import type {
  GeneratedPartObject,
  PartGeneratorDefinition,
  PartGeneratorResult,
} from '../../core/parts/part-generator';
import { materializePartGenerator } from '../../core/parts/materialize-part-generator';
import {
  partGeneratorGeometryMatches,
  regeneratePartGenerator,
} from '../../core/parts/regenerate-part-generator';
import { parsePartGeneratorDefinition } from '../../io/project/project-part-generator-validator';
import type { AppState } from './store';
import { sceneLimitOverrun } from './scene-copy-room';
import { retainGeneratorRecipeBindings } from './part-generator-bindings';

export type PreparedPartGenerator = {
  readonly project: Project;
  readonly documentEpoch: number;
  readonly nextProject: Project;
  readonly object: GeneratedPartObject;
  readonly previousObject: GeneratedPartObject | undefined;
  readonly operationNames: readonly string[];
  readonly removedPathKeys: readonly string[];
  readonly geometryMismatch: boolean;
  /** Placed tabs with no matching edge on the new outline, and on removed holes. */
  readonly movedTabs: number;
  readonly removedTabs: number;
};
export function preparePartGenerator(
  state: AppState,
  definition: PartGeneratorDefinition,
  objectId?: string,
  openedTransform?: Transform,
): PartGeneratorResult<PreparedPartGenerator> {
  const parsed = parsePartGeneratorDefinition(definition);
  if (parsed.kind === 'invalid') return parsed;
  const target = editablePart(state.project, objectId, openedTransform);
  if (target.kind === 'invalid') return target;
  const previous = target.value;
  const built =
    previous === undefined
      ? createPart(state, parsed.value)
      : updatePart(state.project, previous, parsed.value);
  if (built.kind === 'invalid') return built;
  const nextProject = built.value.project;
  const overrun = sceneLimitOverrun(
    state.project.scene,
    nextProject.scene,
    'Delete artwork or operations before creating another generated part.',
  );
  if (overrun !== null) return invalid(overrun);
  const object = built.value.object;
  const used = new Set(operationIdsForObject(object, nextProject.scene.layers));
  return {
    kind: 'ok',
    value: {
      project: state.project,
      documentEpoch: state.projectDocumentEpoch,
      nextProject,
      object,
      previousObject: previous,
      operationNames: nextProject.scene.layers
        .filter((layer) => used.has(layer.id))
        .map((layer) => layer.name),
      removedPathKeys:
        previous?.partGenerator.pathKeys.filter(
          (key) => !object.partGenerator.pathKeys.includes(key),
        ) ?? [],
      geometryMismatch: previous !== undefined && !partGeneratorGeometryMatches(previous),
      movedTabs: built.value.movedTabs,
      removedTabs: built.value.removedTabs,
    },
  };
}
type BuiltPart = {
  readonly object: GeneratedPartObject;
  readonly project: Project;
  readonly movedTabs: number;
  readonly removedTabs: number;
};
function createPart(
  state: AppState,
  definition: PartGeneratorDefinition,
): PartGeneratorResult<BuiltPart> {
  const generated = materializePartGenerator(definition);
  if (generated.kind === 'invalid') return generated;
  const geometry = generated.value;
  const source: GeneratedPartObject = {
    kind: 'imported-svg',
    id: crypto.randomUUID(),
    source: definition.name + '.part',
    name: definition.name,
    transform: IDENTITY_TRANSFORM,
    bounds: geometry.bounds,
    paths: geometry.paths,
    partGenerator: geometry.source,
  };
  const prepared = prepareDimensionedVector(state, source);
  return {
    kind: 'ok',
    value: {
      object: prepared.object as GeneratedPartObject,
      project: prepared.project,
      movedTabs: 0,
      removedTabs: 0,
    },
  };
}
function replacementProject(
  project: Project,
  before: GeneratedPartObject,
  after: GeneratedPartObject,
): Project {
  const applications = retainGeneratorRecipeBindings(project, before, after);
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) => (object.id === before.id ? after : object)),
    },
    ...(applications === undefined ? {} : { processRecipeApplications: applications }),
  };
}
function invalid(reason: string): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason };
}

function updatePart(
  project: Project,
  before: GeneratedPartObject,
  definition: PartGeneratorDefinition,
): PartGeneratorResult<BuiltPart> {
  const regenerated = regeneratePartGenerator(before, definition);
  return regenerated.kind === 'invalid'
    ? regenerated
    : {
        kind: 'ok',
        value: {
          ...regenerated.value,
          project: replacementProject(project, before, regenerated.value.object),
        },
      };
}

function editablePart(
  project: Project,
  objectId: string | undefined,
  openedTransform: Transform | undefined,
): PartGeneratorResult<GeneratedPartObject | undefined> {
  if (objectId === undefined) return { kind: 'ok', value: undefined };
  const existing = project.scene.objects.find((object) => object.id === objectId);
  if (existing === undefined)
    return invalid('The generated part is missing. Select a current part.');
  if (existing.kind !== 'imported-svg' || existing.partGenerator === undefined)
    return invalid('Select an editable generated part.');
  if (existing.locked === true)
    return invalid('Unlock this generated part before changing its dimensions.');
  if (existing.constrainedSketch !== undefined || existing.booleanCompound !== undefined)
    return invalid('Bake the other retained geometry source before editing this part generator.');
  // The editor folded the scale it opened on into its lengths (ADR-573 Amendment 1).
  const now = existing.transform;
  if (
    openedTransform !== undefined &&
    (now.scaleX !== openedTransform.scaleX || now.scaleY !== openedTransform.scaleY)
  )
    return invalid(
      'The part was resized after this editor opened. Close and reopen it to edit its current size.',
    );
  return { kind: 'ok', value: existing as GeneratedPartObject };
}

import { prepareDimensionedVector } from './prepare-dimensioned-vector';
