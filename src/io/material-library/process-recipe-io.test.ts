import { describe, expect, it } from 'vitest';
import {
  capturedRecipe,
  recipeProject,
} from '../../core/material-library/process-recipe.test-fixture';
import {
  deserializeMaterialLibrary,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  mergeMaterialLibraries,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
} from './material-library-io';

function library(cnc = false): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'recipes',
    name: 'Recipes',
    entries: [],
    processRecipes: [capturedRecipe(recipeProject(cnc))],
  };
}

describe('process recipe library documents', () => {
  it.each([false, true])('roundtrips every process field deterministically (CNC=%s)', (cnc) => {
    const document = library(cnc);
    const encoded = serializeMaterialLibrary(document);
    const result = deserializeMaterialLibrary(encoded);
    expect(result).toEqual({ kind: 'ok', library: document });
    if (result.kind === 'ok') expect(serializeMaterialLibrary(result.library)).toBe(encoded);
    expect(JSON.parse(encoded).librarySchemaVersion).toBe(2);
  });

  it('loads version-one single-preset libraries and reports newer schemas', () => {
    const { processRecipes: _recipes, ...base } = library();
    expect(
      deserializeMaterialLibrary(JSON.stringify({ ...base, librarySchemaVersion: 1 })),
    ).toEqual({ kind: 'ok', library: base });
    expect(
      deserializeMaterialLibrary(JSON.stringify({ ...base, librarySchemaVersion: 3 })).kind,
    ).toBe('schema-too-new');
  });

  it.each([
    (recipe: Record<string, unknown>) => ({ ...recipe, steps: [] }),
    (recipe: Record<string, unknown>) => ({ ...recipe, pathSteps: [[99]] }),
    (recipe: Record<string, unknown>) => ({
      ...recipe,
      steps: [{ ...(recipe.steps as object[])[0], settings: { speed: -1 } }],
    }),
  ])('rejects malformed recipe content without dropping it silently', (change) => {
    const doc = library();
    expect(
      deserializeMaterialLibrary(
        JSON.stringify({ ...doc, processRecipes: [change({ ...doc.processRecipes?.[0] })] }),
      ).kind,
    ).toBe('invalid');
  });

  it('rejects malformed CNC geometry and missing tool references', () => {
    const doc = library(true);
    const recipe = doc.processRecipes![0]!;
    expect(
      deserializeMaterialLibrary(
        JSON.stringify({ ...doc, processRecipes: [{ ...recipe, tools: [] }] }),
      ).kind,
    ).toBe('invalid');
    expect(
      deserializeMaterialLibrary(
        JSON.stringify({
          ...doc,
          processRecipes: [
            { ...recipe, tools: recipe.tools?.map((tool) => ({ ...tool, diameterMm: -3 })) },
          ],
        }),
      ).kind,
    ).toBe('invalid');
    expect(
      deserializeMaterialLibrary(
        JSON.stringify({
          ...doc,
          processRecipes: [
            {
              ...recipe,
              steps: recipe.steps.map((step) => ({
                ...step,
                cnc: { ...step.cnc, feedMmPerMin: -1 },
              })),
            },
          ],
        }),
      ).kind,
    ).toBe('invalid');
  });

  it('merges process recipes without replacing an existing ID', () => {
    const base = library();
    const incoming = {
      ...library(true),
      processRecipes: [capturedRecipe(), { ...capturedRecipe(recipeProject(true)), id: 'cnc' }],
    };
    const merged = mergeMaterialLibraries(base, incoming);
    expect(merged.library.processRecipes?.map((recipe) => recipe.id)).toEqual(['process-1', 'cnc']);
    expect(merged.skippedDuplicateIds).toEqual(['process-1']);
  });
});
