// CheckpointResumeBanner (ADR-118) — offers to resume the interrupted job
// recorded by use-job-checkpoint. Shown only when a checkpoint with real
// progress exists and no job is active; Resume re-compiles the project and
// refuses on a fingerprint mismatch (runCheckpointResumeFlow), Dismiss
// discards the record explicitly.

import { useEffect, useState } from 'react';
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
        {checkpoint.sendableLines} motion lines confirmed. Resume re-checks that the project still
        produces the same G-code, then replays from the first unconfirmed line. If the machine also
        lost power, a few confirmed lines may not have run — backing up re-burns, skipping leaves
        gaps.
      </p>
      <div style={rowStyle}>
        <button
          type="button"
          disabled={props.disabled || props.busy}
          onClick={() => void runCheckpointResumeFlow(checkpoint)}
          title="Verify the project still compiles to the interrupted program, then resume at the first unconfirmed line. Work zero must be unchanged."
        >
          Resume interrupted job
        </button>
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
