// ADR-496: the library recipe a new laser operation takes for this job's
// material. A recipe qualifies only when it is for the same material and the
// operation's own mode, so applying it never changes what the operation does.
// A cut needs the job's thickness (or a recipe for any thickness); an engraving
// or image prefers the same thickness but takes another, since a surface
// process does not depend on how thick the sheet is. Among the qualifying
// recipes the existing ranking decides: the machine profile before the machine
// family, laser model and head, calibrated before imported before starter.

import type { DeviceProfile } from '../devices';
import type { LayerMode } from '../scene';
import type { MaterialRecipe } from './material-library';
import {
  rankMaterialRecipeCandidates,
  recipeConfidence,
  type MaterialRecipeCandidate,
  type MaterialRecipeMatch,
  type MaterialRecipeOperation,
} from './material-matching';

export type AutoRecipeCandidate = MaterialRecipeCandidate & {
  readonly materialName: string;
  readonly recipe: MaterialRecipe;
};

export type JobMaterial = {
  readonly name: string;
  readonly thicknessMm?: number;
};

const THICKNESS_TOLERANCE_MM = 0.001;

// The kinds of recipe each mode takes, best first. A recipe that names no
// operation fits any of them.
const OPERATIONS_FOR_MODE: Readonly<Record<LayerMode, ReadonlyArray<MaterialRecipeOperation>>> = {
  line: ['cut', 'score'],
  fill: ['engrave'],
  image: ['image', 'engrave'],
};

/** The best recipe for an operation of this mode on the job's material, if any. */
export function bestRecipeForOperation<T extends AutoRecipeCandidate>(
  device: DeviceProfile,
  candidates: ReadonlyArray<T>,
  material: JobMaterial,
  mode: LayerMode,
): MaterialRecipeMatch<T> | undefined {
  const wanted = materialKey(material.name);
  if (wanted === '') return undefined;
  const usable = candidates.filter(
    (candidate) =>
      candidate.recipe.mode === mode &&
      materialKey(candidate.material ?? candidate.materialName) === wanted &&
      recipeConfidence(candidate) !== 'unsupported',
  );
  for (const tier of thicknessTiers(usable, material.thicknessMm, mode)) {
    for (const operation of OPERATIONS_FOR_MODE[mode]) {
      const best = rankMaterialRecipeCandidates(device, tier, { operation })[0];
      if (best !== undefined) return best;
    }
  }
  return undefined;
}

/** The materials a library has recipes for, with the thicknesses of each. */
export function jobMaterialChoices(
  candidates: ReadonlyArray<Pick<AutoRecipeCandidate, 'material' | 'materialName' | 'thicknessMm'>>,
): ReadonlyArray<{ readonly name: string; readonly thicknessesMm: ReadonlyArray<number> }> {
  const byKey = new Map<string, { name: string; thicknesses: Set<number> }>();
  for (const candidate of candidates) {
    const name = (candidate.material ?? candidate.materialName).trim();
    const key = materialKey(name);
    if (key === '') continue;
    const entry = byKey.get(key) ?? { name, thicknesses: new Set<number>() };
    if (candidate.thicknessMm !== undefined) entry.thicknesses.add(candidate.thicknessMm);
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .map((entry) => ({
      name: entry.name,
      thicknessesMm: [...entry.thicknesses].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function materialKey(name: string): string {
  return name.trim().toLowerCase();
}

function thicknessTiers<T extends AutoRecipeCandidate>(
  candidates: ReadonlyArray<T>,
  thicknessMm: number | undefined,
  mode: LayerMode,
): ReadonlyArray<ReadonlyArray<T>> {
  const fits = candidates.filter(
    (candidate) =>
      candidate.thicknessMm === undefined ||
      (thicknessMm !== undefined &&
        Math.abs(candidate.thicknessMm - thicknessMm) <= THICKNESS_TOLERANCE_MM),
  );
  // Only a cut depends on the sheet's thickness.
  return mode === 'line' ? [fits] : [fits, candidates];
}
