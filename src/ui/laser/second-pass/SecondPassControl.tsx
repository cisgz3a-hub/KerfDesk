import { useState } from 'react';
import { laserSecondPassSupportsController } from '../../../core/laser-second-pass/source-family';
import {
  recoveryRepository,
  type RecoveryRepository,
  type RecoveryRepositorySnapshot,
} from '../../state/recovery';
import { useLaserSecondPassUiStore } from '../../state/laser-second-pass-ui-store';
import { useRecoveryRepositorySelection } from '../../state/use-recovery-repository';

export function SecondPassControl(props: {
  busy: boolean;
  machineKind: 'laser' | 'cnc';
  repository?: RecoveryRepository;
}): JSX.Element | null {
  const repository = props.repository ?? recoveryRepository;
  const snapshot = useRecoveryRepositorySelection(selectCompletedSlots, repository);
  const [selected, setSelected] = useState('');
  const openEditor = useLaserSecondPassUiStore((s) => s.openEditor);
  const records = snapshot.executionHistory
    .filter((record) => record.terminalKind === 'completed')
    .slice()
    .reverse();
  const latest = snapshot.lastCompletedReceipt;
  const runId = selectedCompletedRun(records, selected, latest?.runId);
  if (props.machineKind !== 'laser' || !runId) return null;
  // Only the latest completion carries its program's controller family here;
  // an older selection is checked when its archive opens.
  const unsupported =
    latest != null &&
    runId === latest.runId &&
    !laserSecondPassSupportsController(latest.artifact.prepared.project.device.controllerKind);
  if (unsupported && records.length <= 1) return null;
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
            disabled={props.busy}
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
      {unsupported ? (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--lf-text-muted)' }} role="note">
          Painted second passes support jobs generated for GRBL, grblHAL and FluidNC. Choose another
          completed job.
        </p>
      ) : (
        <button
          className="lf-btn lf-btn--sm"
          title="Open the saved engraving to paint or erase areas for another pass."
          disabled={props.busy}
          onClick={() => openEditor(runId)}
        >
          Paint a second pass…
        </button>
      )}
    </div>
  );
}

function selectCompletedSlots({
  executionHistory,
  lastCompletedReceipt,
}: RecoveryRepositorySnapshot) {
  return { executionHistory, lastCompletedReceipt };
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
