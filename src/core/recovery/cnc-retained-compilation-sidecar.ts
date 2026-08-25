import type { Job } from '../job';
// Deep type import: core/job's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import type { CncCompilationSidecar } from '../job/job';

/**
 * Retain exact compile evidence only for layers that still have CNC motion in
 * a derived recovery Job. This keeps repeated archived recovery truthful
 * without warning about operations the derived Job no longer contains.
 */
export function retainedCncCompilationSidecar(
  source: Job,
  groups: Job['groups'],
): CncCompilationSidecar | undefined {
  const sidecar = source.cncCompilation;
  if (sidecar === undefined) return undefined;

  const retainedLayerIds = new Set(
    groups.filter((group) => group.kind === 'cnc').map((group) => group.layerId),
  );
  if (retainedLayerIds.size === 0) return undefined;
  const vcarveOperations = sidecar.vcarveOperations.filter((entry) =>
    retainedLayerIds.has(entry.layerId),
  );

  return {
    vcarveOperations,
    ...(sidecar.offsetLadderDiagnostics === undefined
      ? {}
      : {
          offsetLadderDiagnostics: sidecar.offsetLadderDiagnostics.filter((entry) =>
            retainedLayerIds.has(entry.layerId),
          ),
        }),
    ...(sidecar.stepoverOperations === undefined
      ? {}
      : {
          stepoverOperations: sidecar.stepoverOperations.filter((entry) =>
            retainedLayerIds.has(entry.layerId),
          ),
        }),
    ...(sidecar.reliefPlans === undefined
      ? {}
      : {
          reliefPlans: sidecar.reliefPlans.filter((entry) => retainedLayerIds.has(entry.layerId)),
        }),
  };
}
