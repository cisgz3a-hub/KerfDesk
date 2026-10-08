import { beforeEach, describe, expect, it } from 'vitest';
import { applyProcessRecipe } from '../../core/material-library/apply-process-recipe';
import type { ProcessRecipe } from '../../core/material-library/process-recipe';
import {
  freshRecipeProject,
  recipeProject,
} from '../../core/material-library/process-recipe.test-fixture';
import { remapRecipeTools } from '../../core/material-library/process-recipe-tools';
import {
  deserializeMaterialLibrary,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import { captureArtworkExperiment } from '../material-library/capture-material-experiment';
import { testExperiment } from '../material-library/material-experiment.test-fixture';
import {
  EMPTY_MATERIAL_LIBRARY_COLLECTION,
  libraryDocument,
  reconcileActiveDocument,
  summarizeLibraries,
} from './material-library-collection';
import { useStore } from './store';
import { resetStore } from './test-helpers';
beforeEach(resetStore);
function importExperiment(id: string, cnc = false) {
  useStore.getState().createLibrary('Imported results');
  const record = cnc
    ? captureArtworkExperiment(recipeProject(true), 'source', id, '2026-10-07T03:00:00Z')
    : { ...testExperiment(), id };
  expect(useStore.getState().upsertMaterialExperiment(record).kind).toBe('ok');
  const imported = deserializeMaterialLibrary(
    serializeMaterialLibrary(useStore.getState().materialLibrary!),
  );
  if (imported.kind !== 'ok') throw new Error('Regression input must be a valid imported library');
  useStore.setState({ materialLibrary: imported.library, materialLibraryDirty: false });
  return imported.library;
}
function reopenSaved() {
  const library = useStore.getState().materialLibrary!;
  const payload = serializeMaterialLibrary(library),
    parsed = deserializeMaterialLibrary(payload);
  expect(parsed.kind).toBe('ok');
  const saved = reconcileActiveDocument(EMPTY_MATERIAL_LIBRARY_COLLECTION, library, 1);
  expect(libraryDocument(saved, library.libraryId)).not.toBeNull();
  expect(summarizeLibraries(saved, null)).toHaveLength(1);
  if (parsed.kind !== 'ok') throw new Error('Recipe made the saved library unreadable');
  return parsed.library;
}
function legacyCncExperiment() {
  const id = 'c'.repeat(200);
  const project = recipeProject(true);
  const record = captureArtworkExperiment(project, 'source', id, '2026-10-07T03:00:00Z');
  const captured = record.cells[0]?.process;
  if (captured?.tools === undefined) throw new Error('CNC fixture must capture cutters');
  const toolIds = new Map(captured.tools.map((tool) => [tool.id, `${tool.id}-${'t'.repeat(201)}`]));
  const legacy = {
    ...captured,
    id: `${id}-process`,
    name: 'n'.repeat(201),
    revision: 'r'.repeat(201),
    description: 'd'.repeat(10_001),
    steps: captured.steps.map((step) => ({
      ...step,
      name: 's'.repeat(201),
      ...(step.cnc === undefined ? {} : { cnc: remapRecipeTools(step.cnc, toolIds) }),
    })),
    tools: captured.tools.map((tool) => ({
      ...tool,
      id: toolIds.get(tool.id) ?? tool.id,
      name: 't'.repeat(201),
    })),
  };
  return { id, project, record, legacy };
}

function expectReopenedLegacyProcess(reopened: MaterialLibraryDocument, legacy: ProcessRecipe) {
  expect(reopened.experiments?.[0]?.cells[0]?.process).toEqual(legacy);
  expect(reopened.processRecipes?.[0]).toEqual(legacy);
  expect(reopened.processRecipes?.[1]?.steps).toEqual(legacy.steps);
  expect(reopened.processRecipes?.[1]?.tools).toEqual(legacy.tools);
}

describe('bounded collision-safe recipe identities from imported material experiments', () => {
  it.each([194, 195, 200])(
    'keeps a valid %i-character experiment portable across numeric suffix boundaries',
    (length) => {
      const id = 'e'.repeat(length),
        original = importExperiment(id),
        originalRecord = original.experiments![0]!;
      const ids: string[] = [];
      for (let index = 0; index < 12; index++) {
        const result = useStore.getState().saveExperimentCellAsRecipe(id, '0-0', 'Measured result');
        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') throw new Error(result.reason);
        ids.push(result.value);
        expect(result.value.length).toBeLessThanOrEqual(200);
        const reopened = reopenSaved();
        expect(reopened.experiments![0]!.id).toBe(id);
        expect(reopened.experiments![0]!.cells[0]!.process).toEqual(
          originalRecord.cells[0]!.process,
        );
        expect(reopened.experiments![0]!.cells[0]!.recipeRef?.id).toBe(result.value);
      }
      expect(new Set(ids).size).toBe(12);
      expect(useStore.getState().materialLibrary!.entries).toHaveLength(12);
      if (length === 194) expect(ids[0]).toBe(`${id}-0-0-1`);
      expect(originalRecord.cells[0]!.recipeRef).toBeUndefined();
    },
  );
  it('avoids collisions across material and process stores after truncation', () => {
    const id = 'e'.repeat(200),
      imported = importExperiment(id);
    const first = useStore.getState().saveExperimentCellAsRecipe(id, '0-0', 'First');
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') throw new Error(first.reason);
    const blockedId = `${`${id}-0-0`.slice(0, 198)}-2`;
    const library = useStore.getState().materialLibrary!;
    const existingRecipe = { ...imported.experiments![0]!.cells[0]!.process, id: blockedId };
    useStore.setState({ materialLibrary: { ...library, processRecipes: [existingRecipe] } });
    const second = useStore.getState().saveExperimentCellAsRecipe(id, '0-0', 'Second');
    expect(second.kind).toBe('ok');
    if (second.kind !== 'ok') throw new Error(second.reason);
    expect(second.value).not.toBe(first.value);
    expect(second.value).not.toBe(blockedId);
    expect(second.value.length).toBeLessThanOrEqual(200);
    const reopened = reopenSaved();
    expect(reopened.entries[0]!.id).toBe(first.value);
    expect(reopened.processRecipes![0]!.id).toBe(blockedId);
  });
  it.each([192, 193, 200])(
    'also bounds complete CNC process recipes without changing tools or source settings (%i characters)',
    (length) => {
      const id = 'c'.repeat(length),
        original = importExperiment(id, true);
      const result = useStore
        .getState()
        .saveExperimentCellAsRecipe(id, '0-0', 'Complete CNC process');
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') throw new Error(result.reason);
      expect(result.value.length).toBeLessThanOrEqual(200);
      const saved = reopenSaved();
      expect(saved.processRecipes).toHaveLength(1);
      expect(saved.processRecipes![0]!.tools).toEqual(
        original.experiments![0]!.cells[0]!.process.tools,
      );
      expect(saved.processRecipes![0]!.steps).toEqual(
        original.experiments![0]!.cells[0]!.process.steps,
      );
      expect(original.experiments?.[0]?.id).toBe(id);
      expect(original.experiments?.[0]?.cells[0]?.process.id.length).toBeLessThanOrEqual(200);
    },
  );
  it('keeps long parent IDs distinct through captured processes, recipes and reopen', () => {
    const ids = ['a', 'b'].map((ending) => `${'c'.repeat(199)}${ending}`);
    const project = recipeProject(true);
    const records = ids.map((id) =>
      captureArtworkExperiment(project, 'source', id, '2026-10-07T03:00:00Z'),
    );
    const processIds = records.flatMap((record) => record.cells.map((cell) => cell.process.id));
    expect(new Set(processIds).size).toBe(2);
    useStore.getState().createLibrary('Distinct long experiments');
    for (const record of records)
      expect(useStore.getState().upsertMaterialExperiment(record).kind).toBe('ok');
    const recipeIds = ids.map((id) => {
      const result = useStore.getState().saveExperimentCellAsRecipe(id, '0-0', 'CNC result');
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') throw new Error(result.reason);
      return result.value;
    });
    expect(new Set(recipeIds).size).toBe(2);
    const saved = reopenSaved();
    expect(saved.experiments?.map((record) => record.id)).toEqual(ids);
    expect(
      saved.experiments?.flatMap((record) => record.cells.map((cell) => cell.process.id)),
    ).toEqual(processIds);
    expect(saved.processRecipes?.map((recipe) => recipe.id)).toEqual(recipeIds);
  });
  it('loads and applies a saved legacy CNC experiment without changing long metadata or identities', () => {
    const { id, project, record, legacy } = legacyCncExperiment();
    useStore.getState().createLibrary('Saved before semantic templates');
    const library = useStore.getState().materialLibrary;
    if (library === null) throw new Error('Library fixture must exist');
    const document = {
      ...library,
      processRecipes: [legacy],
      experiments: [
        { ...record, cells: record.cells.map((cell) => ({ ...cell, process: legacy })) },
      ],
    };
    const imported = deserializeMaterialLibrary(serializeMaterialLibrary(document));
    expect(imported).toEqual({ kind: 'ok', library: document });
    if (imported.kind !== 'ok') throw new Error('Legacy saved experiment must load');
    useStore.setState({ materialLibrary: imported.library, materialLibraryDirty: false });
    const result = useStore.getState().saveExperimentCellAsRecipe(id, '0-0', 'Reusable legacy CNC');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.value.length).toBeLessThanOrEqual(200);
    const reopened = reopenSaved();
    expectReopenedLegacyProcess(reopened, legacy);
    const applied = applyProcessRecipe(freshRecipeProject(project), ['fresh'], legacy);
    expect(applied.kind).toBe('ok');
    if (applied.kind === 'ok' && applied.value.machine?.kind === 'cnc')
      for (const tool of legacy.tools)
        expect(applied.value.machine.tools.find((candidate) => candidate.id === tool.id)).toEqual(
          tool,
        );
  });
  it('preserves existing ordinary UUID-based recipe IDs', () => {
    const id = '67a32e53-086b-41c4-af11-6dc253e491c1';
    importExperiment(id);
    const result = useStore.getState().saveExperimentCellAsRecipe(id, '0-0', 'Ordinary result');
    expect(result).toEqual({ kind: 'ok', value: `${id}-0-0-1` });
    reopenSaved();
  });
  it('refuses a mutation that would persist an invalid complete library, without reporting success', () => {
    const original = importExperiment('valid');
    const corrupt = {
      ...original,
      experiments: [
        ...original.experiments!,
        { ...testExperiment(), id: 'invalid', notes: 'x'.repeat(10_001) },
      ],
    };
    useStore.setState({ materialLibrary: corrupt, materialLibraryDirty: false });
    expect(useStore.getState().saveExperimentCellAsRecipe('valid', '0-0', 'Result').kind).toBe(
      'invalid',
    );
    expect(useStore.getState().materialLibrary).toBe(corrupt);
    expect(useStore.getState().materialLibraryDirty).toBe(false);
  });
});
