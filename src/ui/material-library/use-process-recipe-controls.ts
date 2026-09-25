import { useState } from 'react';
import { machineKindOf, type MachineKind } from '../../core/scene';
import type { ProcessRecipe } from '../../core/material-library/process-recipe';
import { useStore } from '../state';

export type ProcessRecipeControls = {
  readonly kind: MachineKind;
  readonly name: string;
  readonly setName: (name: string) => void;
  readonly count: number;
  readonly recipes: ReadonlyArray<ProcessRecipe>;
  readonly recipe: ProcessRecipe | undefined;
  readonly select: (id: string) => void;
  readonly status: string;
  readonly save: () => void;
  readonly apply: () => void;
  readonly remove: () => void;
};

export function useProcessRecipeControls(): ProcessRecipeControls {
  const project = useStore((state) => state.project);
  const library = useStore((state) => state.materialLibrary);
  const selected = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const saveRecipe = useStore((state) => state.saveSelectedProcessRecipe);
  const applyRecipe = useStore((state) => state.applyProcessRecipeToSelection);
  const deleteRecipe = useStore((state) => state.deleteProcessRecipe);
  const [name, setName] = useState('');
  const [chosenId, select] = useState('');
  const [status, setStatus] = useState('');
  const kind = machineKindOf(project.machine);
  const recipes = (library?.processRecipes ?? []).filter((recipe) => recipe.machineKind === kind);
  const recipe = recipes.find((candidate) => candidate.id === chosenId) ?? recipes[0];
  const count = new Set([...(selected === null ? [] : [selected]), ...additional]).size;
  const save = (): void => {
    const result = saveRecipe(name);
    setStatus(
      result.kind === 'invalid'
        ? result.reason
        : `Saved ${result.value.name} (${result.value.steps.length} steps).`,
    );
    if (result.kind === 'ok') {
      select(result.value.id);
      setName('');
    }
  };
  const apply = (): void => {
    if (recipe === undefined) return;
    const result = applyRecipe(recipe.id);
    setStatus(
      result.kind === 'invalid'
        ? result.reason
        : `Applied ${recipe.name} to ${result.value} artwork${result.value === 1 ? '' : 's'}.`,
    );
  };
  const remove = (): void => {
    if (recipe === undefined) return;
    deleteRecipe(recipe.id);
    setStatus(`Deleted ${recipe.name}.`);
  };
  return { kind, name, setName, count, recipes, recipe, select, status, save, apply, remove };
}
