import type { AiCandidate } from '../../core/ai/assistant';
import type { ProcessRecipe } from '../../core/material-library/process-recipe';
import type { MaterialLibraryDocument } from '../../io/material-library';
import type { MachineKind } from '../../core/scene';

export function aiMaterialCandidates(
  library: MaterialLibraryDocument | null,
  kind: MachineKind,
  query = '',
): readonly AiCandidate[] {
  if (library === null) return [];
  const presets =
    kind !== 'laser'
      ? []
      : library.entries.map((preset) => ({
          id: `material:${preset.id}`,
          name: (preset.title || preset.materialName).slice(0, 500),
          description:
            `${preset.materialName}; ${preset.thicknessMm ?? 'unknown'} mm; ${preset.description}; qualification: ${preset.confidence ?? 'not recorded'}`.slice(
              0,
              2000,
            ),
        }));
  const processes = (library.processRecipes ?? [])
    .filter((recipe) => recipe.machineKind === kind)
    .map((recipe) => ({
      id: `process:${recipe.id}`,
      name: recipe.name.slice(0, 500),
      description: (
        recipe.description || `${kind} process; qualification not established by AI`
      ).slice(0, 2000),
    }));
  const needle = query.trim().normalize('NFC').toLocaleLowerCase();
  return [...presets, ...processes]
    .filter((candidate) =>
      `${candidate.id} ${candidate.name} ${candidate.description}`
        .normalize('NFC')
        .toLocaleLowerCase()
        .includes(needle),
    )
    .slice(0, 50);
}
export function suggestedProcess(
  library: MaterialLibraryDocument,
  id: string,
): ProcessRecipe | undefined {
  return id.startsWith('process:')
    ? library.processRecipes?.find((recipe) => `process:${recipe.id}` === id)
    : undefined;
}
