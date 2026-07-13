// CheckpointResumeBanner (ADR-118, ADR-141) — offers executable recovery for
// interrupted laser jobs and diagnostic evidence only for CNC checkpoints.

import { useEffect, useState } from 'react';
import { CNC_AUTOMATIC_RECOVERY_DISABLED_REASON } from '../../core/controllers/grbl';
import type { JobCheckpoint } from '../../core/recovery';
import { clearJobCheckpoint, readJobCheckpoint } from '../state/job-checkpoint-storage';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { runCheckpointResumeFlow } from './start-job-flow';

export function CheckpointResumeBanner(props: {
  readonly disabled: boolean;
  readonly busy: boolean;
}): JSX.Element | null {
  const jobActive = useLaserStore((s) => isActiveJob(s.streamer));
  const [checkpoint, setCheckpoint] = useState<JobCheckpoint | null>(null);
  // Re-read whenever the job state settles: on mount, after a run ends, and
  // after a resume attempt (successful ones flip jobActive; refused ones
  // leave the record for another try).
  useEffect(() => {
    if (!jobActive) setCheckpoint(readJobCheckpoint());
  }, [jobActive]);
  if (jobActive || checkpoint === null || checkpoint.ackedLines === 0) return null;
  const startedAt = formatStartedAt(checkpoint.startedAtIso);
  return (
    <div style={bannerStyle} role="status">
      <p style={textStyle}>
        Interrupted {checkpoint.machineKind === 'cnc' ? 'router' : 'laser'} job
        {startedAt === null ? '' : ` from ${startedAt}`}: {checkpoint.ackedLines} of{' '}
        {checkpoint.sendableLines} G-code lines acknowledged by the controller.{' '}
        {checkpoint.machineKind === 'cnc'
          ? `${CNC_AUTOMATIC_RECOVERY_DISABLED_REASON} The checkpoint is retained as diagnostic evidence until you dismiss it.`
          : 'Resume re-checks that the project still produces the same G-code. Laser recovery replays from the first unconfirmed line. If the controller lost power, a few acknowledged lines may not have run.'}
      </p>
      {checkpoint.interruption === undefined ? null : (
        <p style={causeStyle}>
          <strong>Recorded cause:</strong> {checkpoint.interruption.message}
          {checkpoint.interruption.rejectedLine === undefined
            ? ''
            : ` Rejected command: ${checkpoint.interruption.rejectedLine}`}
        </p>
      )}
      <div style={rowStyle}>
        {checkpoint.machineKind === 'laser' ? (
          <button
            type="button"
            disabled={props.disabled || props.busy}
            onClick={() => void runCheckpointResumeFlow(checkpoint)}
            title="Verify the project, review the safe recovery point, and continue only if work zero is unchanged."
          >
            Review safe recovery
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            clearJobCheckpoint();
            setCheckpoint(null);
          }}
          title="Discard the interrupted-job record."
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function formatStartedAt(iso: string): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

const bannerStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderLeft: '3px solid var(--lf-warning)',
  borderRadius: 4,
  padding: '6px 8px',
};
const textStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '0 0 6px 0',
};
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6 };
const causeStyle: React.CSSProperties = {
  ...textStyle,
  color: 'var(--lf-danger)',
  fontWeight: 500,
};
