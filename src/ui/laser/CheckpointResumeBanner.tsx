// CheckpointResumeBanner (ADR-118, ADR-200) — offers line-safe laser recovery
// and a separately generated, explicitly qualified CNC recovery job.

import { useEffect, useState } from 'react';
import type { JobCheckpoint } from '../../core/recovery';
import { clearJobCheckpoint, readJobCheckpoint } from '../state/job-checkpoint-storage';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { runCheckpointResumeFlow } from './start-job-flow';
import { CncRecoveryPreviewWizard } from './CncRecoveryPreviewWizard';

export function CheckpointResumeBanner(props: {
  readonly disabled: boolean;
  readonly busy: boolean;
}): JSX.Element | null {
  const jobActive = useLaserStore((s) => isActiveJob(s.streamer));
  const [checkpoint, setCheckpoint] = useState<JobCheckpoint | null>(null);
  const [cncPreviewOpen, setCncPreviewOpen] = useState(false);
  // Re-read whenever the job state settles: on mount, after a run ends, and
  // after a resume attempt (successful ones flip jobActive; refused ones
  // leave the record for another try).
  useEffect(() => {
    if (!jobActive) setCheckpoint(readJobCheckpoint());
  }, [jobActive]);
  if (
    jobActive ||
    checkpoint === null ||
    (checkpoint.machineKind === 'laser' && checkpoint.ackedLines === 0)
  ) {
    return null;
  }
  const startedAt = formatStartedAt(checkpoint.startedAtIso);
  return (
    <>
      <div style={bannerStyle} role="status">
        <p style={textStyle}>
          Interrupted {checkpoint.machineKind === 'cnc' ? 'router' : 'laser'} job
          {startedAt === null ? '' : ` from ${startedAt}`}: {checkpoint.ackedLines} of{' '}
          {checkpoint.sendableLines} G-code lines acknowledged by the controller.{' '}
          {checkpoint.machineKind === 'cnc'
            ? cncCheckpointMessage(checkpoint)
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
          <ReviewRecoveryAction
            checkpoint={checkpoint}
            disabled={props.disabled || props.busy}
            onOpenCncPreview={() => setCncPreviewOpen(true)}
          />
          <button
            type="button"
            onClick={() => {
              clearJobCheckpoint();
              setCncPreviewOpen(false);
              setCheckpoint(null);
            }}
            title="Discard the interrupted-job record."
          >
            Dismiss
          </button>
        </div>
      </div>
      {cncPreviewOpen ? (
        <CncRecoveryPreviewWizard
          checkpoint={checkpoint}
          onClose={() => setCncPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}

function ReviewRecoveryAction(props: {
  readonly checkpoint: JobCheckpoint;
  readonly disabled: boolean;
  readonly onOpenCncPreview: () => void;
}): JSX.Element | null {
  if (props.checkpoint.machineKind === 'laser') {
    return (
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => void runCheckpointResumeFlow(props.checkpoint)}
        title="Verify the project, review the safe recovery point, and continue only if work zero is unchanged."
      >
        Review safe recovery
      </button>
    );
  }
  if (props.checkpoint.resumeInFlight) return null;
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onOpenCncPreview}
      title="Select an uncertain native contour segment, complete physical requalification, and review a newly generated recovery job."
    >
      Review supervised recovery
    </button>
  );
}

function cncCheckpointMessage(checkpoint: JobCheckpoint): string {
  if (checkpoint.resumeInFlight) {
    return 'A supervised recovery attempt was itself interrupted. The original checkpoint no longer identifies current work, so it cannot start another recovery. Inspect and requalify the machine, then create a separately reviewed new job.';
  }
  return 'Acknowledgements are diagnostic only and will not choose a cut position. Review supervised recovery to select the first uncertain native contour segment, physically clear and requalify the machine, and generate a new recovery job.';
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
