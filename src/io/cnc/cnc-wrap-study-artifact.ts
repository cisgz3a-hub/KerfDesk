import type { Project } from '../../core/scene';
import type { CncWrapStudy } from '../../core/scene/cnc-wrap-study';
import { prepareOutput } from '../gcode/prepare-output';
import { planCncWrapReference } from '../../core/cnc/wrap/cnc-wrap-reference-plan';
import { cncWrapReferenceProgram } from '../../core/cnc/wrap/cnc-wrap-reference-program';
import { cncPreparationInputs } from '../../core/cnc/cnc-preparation-dependencies';
import { sha256Hex } from '../../core/relief/sha256';
export function buildCncWrapStudyArtifact(
  project: Project,
  setup: CncWrapStudy,
):
  | {
      readonly kind: 'ok';
      readonly json: string;
      readonly program: string;
      readonly pathCount: number;
      readonly warnings: readonly string[];
    }
  | { readonly kind: 'unavailable'; readonly reason: string } {
  const prepared = prepareOutput(project);
  if (!prepared.ok)
    return {
      kind: 'unavailable',
      reason: 'The current source could not prepare executable CNC paths.',
    };
  const result = planCncWrapReference(prepared.job, setup);
  if (result.kind === 'unavailable') return result;
  try {
    const program = cncWrapReferenceProgram(result.plan);
    const artifact = {
      kind: 'kerfdesk-cnc-wrap-study-v1',
      machineOutputAvailable: false,
      sourceSha256: 'sha256:' + cncPreparationInputs(project).signature,
      programSha256: 'sha256:' + sha256Hex([new TextEncoder().encode(program)]),
      plan: result.plan,
      referenceProgram: program,
    };
    return {
      kind: 'ok',
      json: JSON.stringify(artifact, null, 2),
      program,
      pathCount: result.plan.paths.length,
      warnings: result.plan.warnings,
    };
  } catch (error) {
    return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}
