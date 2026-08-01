import { compileJob, type Group, type RasterGroup } from '../../core/job';
import type { PreparedOutput } from './prepare-output';

export type SuccessfulPreparedOutput = Extract<PreparedOutput, { readonly ok: true }>;

/** Replace function-valued raster providers with deterministic recipe markers
 * so a prepared output can cross a Worker or IndexedDB structured-clone seam. */
export function prepareOutputForStructuredClone(
  prepared: SuccessfulPreparedOutput,
): SuccessfulPreparedOutput {
  let changed = false;
  const groups = prepared.job.groups.map((group): Group => {
    if (group.kind !== 'raster' || group.rowProvider === undefined) return group;
    changed = true;
    const { rowProvider: _provider, ...stored } = group;
    return {
      ...stored,
      sValues: new Uint16Array(0),
      archivedRowProviderRecipe: 'prepared-project',
    };
  });
  return changed ? { ...prepared, job: { ...prepared.job, groups } } : prepared;
}

/** Rebuild archived streamed raster data without changing the stored group
 * order, placement, bounds, or settings that produced the sealed G-code. */
export function hydratePreparedExecutionOutput(
  prepared: SuccessfulPreparedOutput,
): SuccessfulPreparedOutput | null {
  const needsHydration = prepared.job.groups.some(
    (group) => group.kind === 'raster' && group.archivedRowProviderRecipe === 'prepared-project',
  );
  if (!needsHydration) return prepared;
  try {
    const compiledRasters = compileJob(
      prepared.project.scene,
      prepared.project.device,
    ).groups.filter((group): group is RasterGroup => group.kind === 'raster');
    const used = new Set<number>();
    const groups = prepared.job.groups.map((group): Group => {
      if (group.kind !== 'raster' || group.archivedRowProviderRecipe !== 'prepared-project') {
        return group;
      }
      const candidateIndex = compiledRasters.findIndex(
        (candidate, index) => !used.has(index) && rasterRecipeMatches(group, candidate),
      );
      if (candidateIndex < 0)
        throw new Error('Archived raster recipe no longer matches its project.');
      const candidate = compiledRasters[candidateIndex];
      if (candidate === undefined) throw new Error('Archived raster recipe is missing.');
      used.add(candidateIndex);
      const { archivedRowProviderRecipe: _recipe, ...runtime } = group;
      return {
        ...runtime,
        sValues: candidate.sValues,
        ...(candidate.rowProvider === undefined ? {} : { rowProvider: candidate.rowProvider }),
      };
    });
    return { ...prepared, job: { ...prepared.job, groups } };
  } catch {
    return null;
  }
}

function rasterRecipeMatches(stored: RasterGroup, candidate: RasterGroup): boolean {
  return (
    stored.layerId === candidate.layerId &&
    stored.sourceObjectId === candidate.sourceObjectId &&
    stored.pixelWidth === candidate.pixelWidth &&
    stored.pixelHeight === candidate.pixelHeight
  );
}
