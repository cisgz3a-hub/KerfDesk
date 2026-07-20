import type { PlatformAdapter } from '../../platform/types';
import type { RecoveryRepository, RunId } from '../state/recovery';
import { serializeExecutionArtifactExport } from './execution-artifact-export-codec';

export type ExportExecutionArtifactResult =
  | { readonly ok: true; readonly displayName: string }
  | {
      readonly ok: false;
      readonly reason: 'cancelled' | 'not-found' | 'read-failed' | 'write-failed';
      readonly message: string;
    };

export async function exportExecutionArtifact(args: {
  readonly platform: PlatformAdapter;
  readonly repository: RecoveryRepository;
  readonly runId: RunId;
}): Promise<ExportExecutionArtifactResult> {
  const archived = await args.repository.getArchivedExecution(args.runId);
  if (!archived.ok) {
    return archived.error === 'not-found'
      ? {
          ok: false,
          reason: 'not-found',
          message: 'The stored execution artifact is no longer available.',
        }
      : {
          ok: false,
          reason: 'read-failed',
          message: 'The execution archive could not be read from recovery storage.',
        };
  }

  try {
    const target = await args.platform.pickFileForSave({
      suggestedName: suggestedArtifactName(archived.value.createdAtIso, args.runId),
      extensions: ['.lfexecution.json'],
    });
    if (target === null) {
      return { ok: false, reason: 'cancelled', message: 'Execution export cancelled.' };
    }
    // The versioned envelope preserves typed arrays and binds every encoded
    // field. No recompilation, live-store overlay, or regenerated provenance is
    // introduced here.
    await target.write(await serializeExecutionArtifactExport(archived.value));
    return { ok: true, displayName: target.displayName };
  } catch (error) {
    return {
      ok: false,
      reason: 'write-failed',
      message: `Could not export the stored execution artifact: ${errorMessage(error)}`,
    };
  }
}

function suggestedArtifactName(createdAtIso: string, runId: RunId): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(createdAtIso)?.[0] ?? 'undated';
  const safeRunId = runId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
  return `kerfdesk-execution-${date}-${safeRunId}.lfexecution.json`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
