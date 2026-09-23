import { beforeEach, describe, expect, it } from 'vitest';
import {
  freshRecipeProject,
  recipeProject,
} from '../../core/material-library/process-recipe.test-fixture';
import { deserializeMaterialLibrary, serializeMaterialLibrary } from '../../io/material-library';
import { deserializeProject, serializeProject } from '../../io/project';
import { createLayer } from '../../core/scene';
import {
  EMPTY_MATERIAL_LIBRARY_COLLECTION,
  libraryDocument,
  reconcileActiveDocument,
  summarizeLibraries,
} from './material-library-collection';
import { persistCollection, restoreCollection } from './material-library-persistence';
import { resetStore } from './test-helpers';
import { useStore } from './store';

describe('process recipe state and persistence', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });
  it.each([false, true])(
    'saves, cold-restores and applies an ordered recipe with undo (CNC=%s)',
    (cnc) => {
      const source = recipeProject(cnc);
      useStore.setState({ project: source, selectedObjectId: 'source' });
      useStore.getState().createLibrary('Process library');
      const saved = useStore.getState().saveSelectedProcessRecipe('My process');
      expect(saved.kind).toBe('ok');
      expect(useStore.getState().project).toBe(source);
      expect(useStore.getState().undoStack).toHaveLength(0);
      const library = useStore.getState().materialLibrary!;
      const collection = reconcileActiveDocument(EMPTY_MATERIAL_LIBRARY_COLLECTION, library, 10);
      expect(persistCollection(localStorage, collection)).toBe(true);
      const restored = restoreCollection(localStorage)!;
      expect(summarizeLibraries(restored, library)[0]?.processRecipeCount).toBe(1);
      const document = libraryDocument(restored, library.libraryId)!;
      expect(document.processRecipes).toEqual(library.processRecipes);
      const imported = deserializeMaterialLibrary(serializeMaterialLibrary(document));
      if (imported.kind !== 'ok' || saved.kind !== 'ok') throw new Error('failed fixture');
      const target = freshRecipeProject(source);
      useStore.setState({
        project: target,
        selectedObjectId: 'fresh',
        materialLibrary: imported.library,
        undoStack: [],
        redoStack: [],
      });
      expect(useStore.getState().applyProcessRecipeToSelection(saved.value.id)).toEqual({
        kind: 'ok',
        value: 1,
      });
      expect(useStore.getState().project.scene.layers.map((layer) => layer.output)).toEqual([
        true,
        false,
        true,
      ]);
      expect(useStore.getState().undoStack).toEqual([target]);
      const applied = useStore.getState().project;
      const reopened = deserializeProject(serializeProject(applied));
      if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
      // Loading also adds canonical curves and an empty groups collection.
      expect(reopened.project.scene).toMatchObject(applied.scene);
      if (cnc) expect(reopened.project.machine).toEqual(applied.machine);
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(target);
      useStore.getState().redo();
      expect(useStore.getState().project.scene.layers).toHaveLength(3);
      expect(useStore.getState().materialLibrary?.processRecipes).toEqual(document.processRecipes);
    },
  );
  it('declines incomplete selections without mutating either the project or library', () => {
    const project = recipeProject();
    useStore.setState({ project });
    useStore.getState().createLibrary('Empty');
    const library = useStore.getState().materialLibrary;
    expect(useStore.getState().saveSelectedProcessRecipe('Empty').kind).toBe('invalid');
    expect(useStore.getState().materialLibrary).toBe(library);
    expect(useStore.getState().project).toBe(project);
  });

  it('keeps independent copies reloadable when other artwork already uses the recipe colours', () => {
    const source = recipeProject();
    const object = source.scene.objects[0]!;
    useStore.setState({
      project: {
        ...source,
        scene: {
          ...source.scene,
          objects: [object, { ...object, id: 'second' }, { ...object, id: 'third' }],
        },
      },
      selectedObjectId: 'source',
    });
    useStore.getState().createLibrary('Copies');
    const saved = useStore.getState().saveSelectedProcessRecipe('Three steps');
    if (saved.kind !== 'ok') throw new Error(saved.reason);
    useStore.setState({ selectedObjectId: 'second', additionalSelectedIds: new Set(['third']) });
    expect(useStore.getState().applyProcessRecipeToSelection(saved.value.id).kind).toBe('ok');
    const project = useStore.getState().project;
    expect(new Set(project.scene.layers.map((layer) => layer.color)).size).toBe(9);
    expect(deserializeProject(serializeProject(project)).kind).toBe('ok');
    expect(project.scene.objects[0]).toBe(object);
  });

  it('leaves the project and undo stack intact when applying would exceed its format limit', () => {
    const source = recipeProject();
    useStore.setState({ project: source, selectedObjectId: 'source' });
    useStore.getState().createLibrary('Recipes');
    const saved = useStore.getState().saveSelectedProcessRecipe('Three steps');
    if (saved.kind !== 'ok') throw new Error(saved.reason);
    const fresh = freshRecipeProject(source);
    const target = {
      ...fresh,
      scene: {
        ...fresh.scene,
        layers: [
          ...fresh.scene.layers,
          ...Array.from({ length: 254 }, (_, index) =>
            createLayer({
              id: `unused-${index}`,
              color: `#${(index + 1).toString(16).padStart(6, '0')}`,
            }),
          ),
        ],
      },
    };
    useStore.setState({ project: target, selectedObjectId: 'fresh' });
    expect(useStore.getState().applyProcessRecipeToSelection(saved.value.id)).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('256 operations'),
    });
    expect(useStore.getState().project).toBe(target);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
