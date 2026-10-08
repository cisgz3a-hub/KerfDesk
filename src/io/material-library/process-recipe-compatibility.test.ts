import { describe, expect, it } from 'vitest';
import type { ProcessRecipe } from '../../core/material-library/process-recipe';
import {
  capturedRecipe,
  recipeProject,
} from '../../core/material-library/process-recipe.test-fixture';
import {
  deserializeMaterialLibrary,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
} from './material-library-io';
import {
  parseProcessRecipe,
  parseProcessRecipes,
  parseProcessRecipeStep,
} from './process-recipe-io';

function semantic(recipe: ProcessRecipe): ProcessRecipe {
  return {
    ...recipe,
    roles: [
      { id: 'body', name: 'Body', required: true, stepIndices: [0], selector: { geometry: 'any' } },
    ],
  };
}

describe('legacy process recipe compatibility', () => {
  it('reopens an ordinary collection beyond the new semantic operation capacity', () => {
    const recipe = capturedRecipe(recipeProject(true));
    const document: MaterialLibraryDocument = {
      format: MATERIAL_LIBRARY_FORMAT,
      librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
      libraryId: 'legacy',
      name: 'Legacy recipes',
      entries: [],
      processRecipes: Array.from({ length: 257 }, (_, index) => ({
        ...recipe,
        id: `recipe-${index}`,
      })),
    };
    const encoded = serializeMaterialLibrary(document);
    const reopened = deserializeMaterialLibrary(encoded);
    expect(reopened.kind).toBe('ok');
    if (reopened.kind === 'ok') {
      expect(reopened.library.processRecipes).toHaveLength(257);
      expect(serializeMaterialLibrary(reopened.library)).toBe(encoded);
    }
  });

  it.each(['steps', 'tools'] as const)(
    'preserves an ordinary recipe with 257 %s while bounding a semantic template',
    (field) => {
      const base = capturedRecipe(recipeProject(true));
      const step = base.steps[0],
        tool = base.tools?.[0];
      if (step === undefined || tool === undefined)
        throw new Error('CNC fixture must have a step and cutter');
      const recipe =
        field === 'steps'
          ? { ...base, steps: Array.from({ length: 257 }, () => step) }
          : {
              ...base,
              tools: [
                ...(base.tools ?? []),
                ...Array.from({ length: 257 - (base.tools?.length ?? 0) }, (_, index) => ({
                  ...tool,
                  id: `unused-${index}`,
                })),
              ],
            };
      expect(parseProcessRecipes([recipe])).toEqual({ kind: 'ok', value: [recipe] });
      expect(parseProcessRecipe(semantic(recipe)).kind).toBe('invalid');
    },
  );

  it('preserves positional artwork assignments beyond the new retained application capacity', () => {
    const recipe = {
      ...capturedRecipe(recipeProject(true)),
      pathSteps: Array.from({ length: 100_001 }, () => [0]),
    };
    const result = parseProcessRecipe(recipe);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.pathSteps).toHaveLength(100_001);
      expect(result.value.pathSteps?.[100_000]).toEqual([0]);
      expect(JSON.stringify(result.value.pathSteps)).toBe(JSON.stringify(recipe.pathSteps));
    }
  });

  it('retains metadata bounds for semantic templates and operation snapshots', () => {
    const base = capturedRecipe(recipeProject(true));
    const step = base.steps[0];
    if (step === undefined) throw new Error('CNC fixture must have a step');
    const legacy = {
      ...base,
      id: 'r'.repeat(208),
      name: 'n'.repeat(201),
      revision: 'v'.repeat(201),
      description: 'd'.repeat(10_001),
    };
    expect(parseProcessRecipe(legacy)).toEqual({ kind: 'ok', value: legacy });
    expect(parseProcessRecipe(semantic(legacy)).kind).toBe('invalid');
    const longStep = { ...step, name: 's'.repeat(201) };
    expect(parseProcessRecipeStep(longStep, 'cnc').kind).toBe('invalid');
    expect(parseProcessRecipeStep(longStep, 'cnc', false)).toEqual({ kind: 'ok', value: longStep });
  });
});
