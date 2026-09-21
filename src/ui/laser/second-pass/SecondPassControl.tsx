import { useState } from 'react';
import {
  recoveryRepository,
  type ExecutionArtifactV1,
  type RecoveryRepository,
} from '../../state/recovery';
import { useRecoveryRepositorySnapshot } from '../../state/use-recovery-repository';
import { SecondPassWorkbench } from './SecondPassWorkbench';

export function SecondPassControl(props: {
  busy: boolean;
  machineKind: 'laser' | 'cnc';
  repository?: RecoveryRepository;
}): JSX.Element | null {
  const repository = props.repository ?? recoveryRepository;
  const snapshot = useRecoveryRepositorySnapshot(repository);
  const [source, setSource] = useState<ExecutionArtifactV1 | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const records = snapshot.executionHistory
    .filter((record) => record.terminalKind === 'completed')
    .slice()
    .reverse();
  const runId = selectedCompletedRun(records, selected, snapshot.lastCompletedReceipt?.runId);
  if (props.machineKind !== 'laser' || (!runId && !source)) return null;
  const open = async (): Promise<void> => {
    if (loading || !runId) return;
    setLoading(true);
    setError('');
    try {
      const result = await repository.getArchivedExecution(runId);
      if (!result.ok) throw new Error('This completed job is no longer in the execution archive.');
      if (result.value.machineKind !== 'laser')
        throw new Error(
          'Choose a completed laser engraving. This archived run used a CNC machine.',
        );
      setSource(await originalRetainedSource(result.value, repository));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {records.length > 1 ? (
        <label style={{ fontSize: 12 }}>
          Completed job for a second pass
          <select
            className="lf-select"
            aria-label="Completed job for a second pass"
            title="Choose which completed, archived laser job to use for painting another pass."
            value={runId}
            onChange={(e) => setSelected(e.currentTarget.value)}
            disabled={props.busy || loading}
            style={{ width: '100%' }}
          >
            {records.map((record) => (
              <option key={record.runId} value={record.runId}>
                {new Date(record.terminalAtIso).toLocaleString()} · {record.runId.slice(-8)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button
        className="lf-btn lf-btn--sm"
        title="Open the saved engraving to paint or erase areas for another pass."
        disabled={props.busy || loading}
        onClick={() => void open()}
      >
        {loading ? 'Opening saved job…' : 'Paint a second pass…'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {source ? <SecondPassWorkbench source={source} onClose={() => setSource(null)} /> : null}
    </div>
  );
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
function selectedCompletedRun(
  records: ReadonlyArray<{ runId: string }>,
  selected: string,
  latest: string | undefined,
): string | undefined {
  return records.some((record) => record.runId === selected)
    ? selected
    : (latest ?? records[0]?.runId);
}
