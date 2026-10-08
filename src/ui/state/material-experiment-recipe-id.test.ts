import { beforeEach, describe, expect, it } from 'vitest';
import { recipeProject } from '../../core/material-library/process-recipe.test-fixture';
import { deserializeMaterialLibrary, serializeMaterialLibrary } from '../../io/material-library';
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
  it('also bounds complete CNC process recipes without changing tools or source settings', () => {
    const id = 'c'.repeat(200),
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
