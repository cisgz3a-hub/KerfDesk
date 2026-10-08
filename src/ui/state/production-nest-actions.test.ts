import { beforeEach, describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '../../io/project';
import { planProductionNest } from '../../core/nesting/production-nest-plan';
import { previewProcessRecipe } from '../../core/material-library/process-recipe-selectors';
import { applyProcessRecipeTemplate } from '../../core/material-library/apply-process-recipe-template';
import { combinedBBox, type Project } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import {
  productionDefinitionFixture,
  productionProjectFixture,
} from './production-nest.test-fixture';
import { prepareProductionNest } from './prepare-production-nest';

beforeEach(resetStore);
describe('quantity production sheets', () => {
  it('copies attached artwork, holes, machining and retained templates into reopenable sheets in one undo action', () => {
    const project = productionProjectFixture();
    const definition = productionDefinitionFixture();
    useStore.setState({ project, selectedObjectId: 'source' });
    const prepared = useStore.getState().prepareProductionNest(definition);
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    expect(prepared.value.units[0]?.objects).toHaveLength(4);
    const result = planProductionNest(prepared.value.input);
    expect(result).toMatchObject({ requested: 2, produced: 2, unplaced: 0 });
    expect(useStore.getState().acceptProductionNest(prepared.value, result)).toEqual({
      kind: 'ok',
      value: 2,
    });
    const accepted = useStore.getState().project;
    expect(accepted.scene).toBe(project.scene);
    expect(accepted.sheetBook?.inactive).toHaveLength(2);
    expect(useStore.getState().undoStack).toEqual([project]);
    const ids = new Set<string>();
    for (const archive of accepted.sheetBook!.inactive) {
      const reopened = deserializeProject(archive.projectJson);
      if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
      const output = reopened.project;
      verifyProductionOutput(output, project, ids);
    }
    expect(deserializeProject(serializeProject(accepted)).kind).toBe('ok');
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(project);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(accepted);
    expect(useStore.getState().switchProjectSheet(accepted.sheetBook!.inactive[0]!.id)).toBe(true);
    expect(useStore.getState().project.productionNest?.output?.sheetId).toBe('one');
  });
  it('requires explicit partial acceptance and rejects stale or invalid drafts without mutations', () => {
    const project = productionProjectFixture();
    const definition = productionDefinitionFixture();
    useStore.setState({ project });
    const prepared = useStore
      .getState()
      .prepareProductionNest({ ...definition, sheets: definition.sheets.slice(0, 1) });
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    const result = planProductionNest(prepared.value.input);
    expect(result).toMatchObject({ requested: 2, produced: 1, unplaced: 1 });
    expect(useStore.getState().acceptProductionNest(prepared.value, result).kind).toBe('invalid');
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(
      useStore.getState().acceptProductionNest(prepared.value, { ...result, unplaced: 0 }, true)
        .kind,
    ).toBe('invalid');
    useStore.setState({ project: { ...project, workspace: { ...project.workspace, width: 123 } } });
    expect(useStore.getState().acceptProductionNest(prepared.value, result, true).kind).toBe(
      'invalid',
    );
    expect(useStore.getState().undoStack).toHaveLength(0);
    useStore.setState({ project });
    expect(useStore.getState().acceptProductionNest(prepared.value, result, true).kind).toBe('ok');
    expect(useStore.getState().project.sheetBook?.inactive).toHaveLength(1);
  });
  it('retains requested quantity and exposes missing sources after reopen rather than dropping parts', () => {
    const project = productionProjectFixture();
    useStore.setState({ project });
    expect(
      useStore.getState().saveProductionNestDefinition(productionDefinitionFixture()).kind,
    ).toBe('ok');
    const reopened = deserializeProject(serializeProject(useStore.getState().project));
    if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
    const missing = { ...reopened.project, scene: { ...reopened.project.scene, objects: [] } };
    const prepared = prepareProductionNest(missing, reopened.project.productionNest!);
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    const result = planProductionNest(prepared.value.input);
    expect(result).toMatchObject({ requested: 2, produced: 0, unplaced: 2 });
    expect(result.quantities[0]?.reason).toContain('missing');
  });
  it('refuses amplification of large attached artwork and locked dependencies before producing copies', () => {
    const project = productionProjectFixture();
    const definition = productionDefinitionFixture();
    const locked = {
      ...project,
      scene: {
        ...project.scene,
        objects: project.scene.objects.map((object) =>
          object.id === 'cutout' ? { ...object, locked: true } : object,
        ),
      },
    };
    expect(prepareProductionNest(locked, definition).kind).toBe('invalid');
    expect(
      prepareProductionNest(project, {
        ...definition,
        parts: [{ ...definition.parts[0]!, quantity: 3000 }],
      }).kind,
    ).toBe('invalid');
  });
});

function verifyProductionOutput(output: Project, project: Project, ids: Set<string>): void {
  expect(output.productionNest?.output?.instances).toHaveLength(1);
  expect(output.scene.objects).toHaveLength(4);
  expect(output.scene.layers).toEqual(project.scene.layers);
  expect(output.scene.groups).toHaveLength(1);
  expect(combinedBBox(output.scene.objects)).toMatchObject({
    minX: 2,
    minY: 2,
    maxX: 12,
    maxY: 12,
  });
  verifyProductionAttachments(output);
  for (const object of output.scene.objects) {
    expect(ids.has(object.id)).toBe(false);
    ids.add(object.id);
  }
  expect(output.processRecipeApplications).toHaveLength(1);
  const application = output.processRecipeApplications![0]!;
  const preview = previewProcessRecipe(
    output,
    application.objectIds,
    application.recipe,
    application,
  );
  const reapplied = applyProcessRecipeTemplate(output, application.objectIds, application.recipe, {
    applicationId: application.id,
    reviewedSignature: preview.signature,
  });
  expect(reapplied.kind).toBe('ok');
  if (reapplied.kind === 'ok') expect(reapplied.value).toEqual(output);
  expect(output.machine?.kind === 'cnc' ? output.machine.stock.thicknessMm : null).toBe(6);
}

function verifyProductionAttachments(output: Project): void {
  const label = output.scene.objects.find((object) => object.kind === 'text');
  const photo = output.scene.objects.find((object) => object.kind === 'raster-image');
  if (label?.kind !== 'text' || photo?.kind !== 'raster-image')
    throw new Error('Missing attachments');
  const guide = output.scene.objects.find((object) => object.id === label.pathText?.guideObjectId);
  expect(guide?.id).toBe(photo.imageMaskId);
  expect(guide && 'paths' in guide ? guide.paths[0]?.polylines : []).toHaveLength(2);
}
