// Turns the compile path's JobDiagnostics into Job Review warning strings.
//
// Advisory only, never a gate (rule 7): the return type is a list of strings,
// so there is no channel here that could refuse Frame or Start. The operator
// reads these in the Job Review warnings list and decides.
//
// JobDiagnostic is intentionally not exported from core/job's barrel (a
// CI-ratcheted legacy barrel that may only shrink), so the variant type is
// derived from compileJob's return type — the same idiom job-intent-warnings
// already uses for Group.

import type { compileJob } from '../../core/job';
import { assertNever } from '../../core/scene';

type CompiledJob = ReturnType<typeof compileJob>;
type CompileDiagnostic = NonNullable<CompiledJob['diagnostics']>[number];

export function compileDiagnosticWarnings(job: CompiledJob): ReadonlyArray<string> {
  return (job.diagnostics ?? []).map(diagnosticWarning);
}

function diagnosticWarning(diagnostic: CompileDiagnostic): string {
  switch (diagnostic.kind) {
    case 'offset-fill-failed':
      return offsetFillFailedWarning(diagnostic.layerName);
    case 'kerf-offset-failed':
      return kerfOffsetFailedWarning(diagnostic.layerName);
    default:
      return assertNever(diagnostic, 'JobDiagnostic');
  }
}

// An offset fill whose geometry engine failed produces fewer contours than the
// artwork asks for — or none at all, in which case the layer leaves no group
// behind and would vanish from the job unremarked.
function offsetFillFailedWarning(layerName: string): string {
  return `Offset fill on layer "${layerName}" could not be fully generated: the geometry engine failed partway, so this layer's fill is incomplete or missing from the job. The outline still cuts. Check the preview before running, and try a slightly larger fill spacing or simplify the shape.`;
}

// Kerf compensation runs on the closed contours of a Line layer — the cut that
// makes the part. When the engine fails they are all dropped, so unlike the
// fill case there is no outline left to fall back on: the layer either cuts
// nothing or cuts only its open paths.
function kerfOffsetFailedWarning(layerName: string): string {
  return `Kerf offset on layer "${layerName}" could not be generated: the geometry engine failed, so this layer's closed contours are missing from the job and will NOT be cut. Only its open paths remain. Check the preview before running, and try a smaller kerf offset, or set kerf to 0 to cut the contours uncompensated.`;
}
