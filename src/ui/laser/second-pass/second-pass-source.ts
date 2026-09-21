import type { ExecutionArtifactV1, RecoveryRepository } from '../../state/recovery';

export async function openRetainedSecondPassSource(
  runId: string,
  repository: RecoveryRepository,
): Promise<ExecutionArtifactV1> {
  const result = await repository.getArchivedExecution(runId);
  if (!result.ok) throw new Error('This completed job is no longer in the execution archive.');
  if (result.value.machineKind !== 'laser')
    throw new Error('Choose a completed laser engraving. This archived run used a CNC machine.');
  return originalRetainedSource(result.value, repository);
}

/** Completion of a recovered or painted run still offers the whole original
 * engraving when that independently verified ancestor remains in history. */
async function originalRetainedSource(
  artifact: ExecutionArtifactV1,
  repository: RecoveryRepository,
): Promise<ExecutionArtifactV1> {
  let source = artifact;
  const visited = new Set<string>([source.runId]);
  for (;;) {
    const sourceRunId = originalSourceParent(source);
    if (!sourceRunId || visited.has(sourceRunId)) return source;
    visited.add(sourceRunId);
    const result = await repository.getArchivedExecution(sourceRunId);
    if (!result.ok || result.value.machineKind !== 'laser') return source;
    source = result.value;
  }
}

function originalSourceParent(source: ExecutionArtifactV1): string | undefined {
  const workflow = source.provenance?.schemaVersion === 2 ? source.provenance.workflow : undefined;
  return (
    source.laserSecondPassChain?.[0]?.sourceRunId ??
    (workflow && 'sourceRunId' in workflow ? workflow.sourceRunId : undefined)
  );
}
