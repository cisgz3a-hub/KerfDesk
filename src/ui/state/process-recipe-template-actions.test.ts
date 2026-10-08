import { beforeEach, describe, expect, it } from 'vitest';
import {
  namedProject,
  template,
  target,
} from '../../core/material-library/process-recipe-template.test-fixture';
import { findRecipeApplication } from '../../core/material-library/apply-process-recipe-template';
import { previewProcessRecipe } from '../../core/material-library/process-recipe-selectors';
import { previewProcessRecipeSheets } from './process-recipe-sheet-application';
import { deserializeProject, serializeProject } from '../../io/project';
import { deserializeMaterialLibrary, serializeMaterialLibrary } from '../../io/material-library';
import { resetStore } from './test-helpers';
import { useStore } from './store';

beforeEach(resetStore);
describe('machining template operator state', () => {
  it('requires a reviewed preview and undoes selection bindings, cutter copies and retained intent together', () => {
    const source = namedProject();
    useStore.setState({
      project: source,
      selectedObjectId: 'source',
      additionalSelectedIds: new Set(['cutout']),
    });
    useStore.getState().createLibrary('Machining');
    const saved = useStore.getState().saveSelectedMachiningTemplate('Family sign');
    if (saved.kind !== 'ok') throw new Error(saved.reason);
    const library = deserializeMaterialLibrary(
      serializeMaterialLibrary(useStore.getState().materialLibrary!),
    );
    if (library.kind !== 'ok') throw new Error('library failed');
    const project = target();
    useStore.setState({ project, materialLibrary: library.library, undoStack: [] });
    expect(useStore.getState().applyProcessRecipeToSelection(saved.value.id).kind).toBe('invalid');
    expect(useStore.getState().undoStack).toHaveLength(0);
    const preview = previewProcessRecipe(project, ['source', 'cutout'], saved.value);
    expect(
      useStore.getState().applyProcessRecipeToSelection(saved.value.id, preview.signature),
    ).toMatchObject({ kind: 'ok', value: 2 });
    const applied = useStore.getState().project;
    expect(applied.processRecipeApplications).toHaveLength(1);
    expect(useStore.getState().undoStack).toEqual([project]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(project);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(applied);
    const reopened = deserializeProject(serializeProject(applied));
    if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
    useStore.setState({ project: reopened.project, materialLibrary: null, undoStack: [] });
    const application = reopened.project.processRecipeApplications![0]!;
    const review = previewProcessRecipe(
      reopened.project,
      application.objectIds,
      application.recipe,
      application,
    );
    expect(
      useStore.getState().reapplyProcessRecipeApplication(application.id, review.signature).kind,
    ).toBe('ok');
    expect(useStore.getState().project.scene.layers).toHaveLength(applied.scene.layers.length);
    expect(useStore.getState().project).toEqual(reopened.project);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
  it('updates a library revision without silently changing any previously applied process', () => {
    useStore.setState({
      project: namedProject(),
      selectedObjectId: 'source',
      additionalSelectedIds: new Set(['cutout']),
    });
    useStore.getState().createLibrary('Templates');
    const saved = useStore.getState().saveSelectedMachiningTemplate('Sign');
    if (saved.kind !== 'ok') throw new Error(saved.reason);
    const project = target();
    useStore.setState({ project });
    const preview = previewProcessRecipe(project, ['source', 'cutout'], saved.value);
    useStore.getState().applyProcessRecipeToSelection(saved.value.id, preview.signature);
    const applied = useStore.getState().project;
    const roles = saved.value.roles!.map((role) => ({
      ...role,
      selector: { ...role.selector, objectName: 'Changed role' },
    }));
    const updated = useStore.getState().updateProcessRecipeRoles(
      saved.value.id,
      roles,
      saved.value.steps.map(() => []),
    );
    expect(updated.kind).toBe('ok');
    expect(useStore.getState().project).toBe(applied);
    expect(applied.processRecipeApplications![0]!.recipe.revision).toBe('1');
    expect(useStore.getState().materialLibrary?.processRecipes?.[0]?.revision).toBe('2');
  });
  it('previews all chosen sheets and applies/undoes them atomically, retaining unmatched artwork', () => {
    const active = target();
    const second = {
      ...target(),
      scene: {
        ...target().scene,
        objects: target().scene.objects.map((object) =>
          object.id === 'cutout' ? { ...object, name: 'Other artwork' } : object,
        ),
      },
    };
    const project = {
      ...active,
      sheetBook: {
        activeId: 'one',
        activeName: 'First sign',
        inactive: [
          {
            id: 'two',
            name: 'Revised sign',
            projectJson: serializeProject(second, { compact: true }),
          },
        ],
      },
    };
    useStore.setState({ project, selectedObjectId: 'source' });
    useStore.getState().createLibrary('Sheets');
    useStore.setState({
      materialLibrary: { ...useStore.getState().materialLibrary!, processRecipes: [template()] },
    });
    const review = previewProcessRecipeSheets(project, ['one', 'two'], template());
    if (review.kind !== 'ok') throw new Error(review.reason);
    expect(review.value.sheets.map((sheet) => sheet.name)).toEqual(['First sign', 'Revised sign']);
    expect(review.value.sheets[1]?.preview.missingRoleIds).toHaveLength(1);
    expect(
      useStore
        .getState()
        .applyProcessRecipeToSheets(template().id, ['one', 'two'], review.value.signature),
    ).toEqual({ kind: 'ok', value: 3 });
    const result = useStore.getState().project;
    const archived = deserializeProject(result.sheetBook!.inactive[0]!.projectJson);
    if (archived.kind !== 'ok') throw new Error(JSON.stringify(archived));
    expect(archived.project.processRecipeApplications).toHaveLength(1);
    expect(archived.project.scene.objects[1]?.operationIds).toEqual(['plain']);
    expect(findRecipeApplication(result, ['source', 'cutout'], template().id)).toBeDefined();
    expect(deserializeProject(serializeProject(result)).kind).toBe('ok');
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(project);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(result);
  });
});
