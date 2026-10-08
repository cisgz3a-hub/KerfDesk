import type {
  PartGeneratorDefinition,
  PartGeneratorResult,
  GeneratedPartObject,
} from '../../core/parts/part-generator';
import { bakePartGenerator } from '../../core/parts/regenerate-part-generator';
import { sameRecipeValue } from '../../core/material-library/process-recipe';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import { preparePartGenerator, type PreparedPartGenerator } from './prepare-part-generator';

export type PartGeneratorActions = {
  readonly preparePartGenerator: (
    definition: PartGeneratorDefinition,
    objectId?: string,
  ) => PartGeneratorResult<PreparedPartGenerator>;
  readonly acceptPartGenerator: (prepared: PreparedPartGenerator) => PartGeneratorResult<string>;
  readonly bakePartGenerator: (objectId: string) => PartGeneratorResult<string>;
};
type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;
export function partGeneratorActions(set: Setter, get: () => AppState): PartGeneratorActions {
  const owned = new WeakMap<PreparedPartGenerator, PreparedPartGenerator['nextProject']>();
  return {
    preparePartGenerator: (definition, objectId) => {
      const prepared = preparePartGenerator(get(), definition, objectId);
      if (prepared.kind === 'ok') owned.set(prepared.value, prepared.value.nextProject);
      return prepared;
    },
    acceptPartGenerator: (prepared) => {
      if (
        get().project !== prepared.project ||
        get().projectDocumentEpoch !== prepared.documentEpoch ||
        owned.get(prepared) !== prepared.nextProject
      )
        return {
          kind: 'invalid',
          reason: 'Artwork or setup changed. Preview the part again before applying.',
        };
      owned.delete(prepared);
      if (
        prepared.previousObject !== undefined &&
        sameRecipeValue(prepared.previousObject, prepared.object)
      )
        return { kind: 'ok', value: prepared.object.id };
      let applied = false;
      set((state) => {
        if (
          state.project !== prepared.project ||
          state.projectDocumentEpoch !== prepared.documentEpoch
        )
          return state;
        applied = true;
        return {
          project: prepared.nextProject,
          selectedObjectId: prepared.object.id,
          additionalSelectedIds: new Set<string>(),
          undoStack: pushUndo(state.project, state.undoStack, 'Apply generated part dimensions'),
          redoStack: [],
          dirty: true,
        };
      });
      return applied
        ? { kind: 'ok', value: prepared.object.id }
        : { kind: 'invalid', reason: 'The reviewed part no longer owns the current artwork.' };
    },
    bakePartGenerator: (objectId) => {
      const project = get().project;
      const object = project.scene.objects.find((candidate) => candidate.id === objectId);
      if (object?.kind !== 'imported-svg' || object.partGenerator === undefined)
        return { kind: 'invalid', reason: 'Select an editable generated part to bake.' };
      if (object.locked === true)
        return { kind: 'invalid', reason: 'Unlock the generated part before baking.' };
      const baked = bakePartGenerator(object as GeneratedPartObject);
      set((state) => ({
        project: {
          ...project,
          scene: {
            ...project.scene,
            objects: project.scene.objects.map((candidate) =>
              candidate.id === objectId ? baked : candidate,
            ),
          },
        },
        undoStack: pushUndo(state.project, state.undoStack, 'Bake generated part'),
        redoStack: [],
        dirty: true,
      }));
      return { kind: 'ok', value: objectId };
    },
  };
}
