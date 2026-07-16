// Optional, newest-only recovery capsule. Archived jobs are observational
// until the operator explicitly reaches a final supervised Start action.

import { useState } from 'react';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import {
  recoveryRepository,
  type RecoveryCapsule,
  type RecoveryRepository,
} from '../state/recovery';
import { useRecoveryRepositorySnapshot } from '../state/use-recovery-repository';
import { CncRecoveryPreviewWizard } from './CncRecoveryPreviewWizard';
import { LaserRecoveryReviewDialog } from './LaserRecoveryReviewDialog';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';

export function CheckpointResumeBanner(props: {
  readonly busy: boolean;
  readonly repository?: RecoveryRepository;
}): JSX.Element | null {
  const repository = props.repository ?? recoveryRepository;
  const snapshot = useRecoveryRepositorySnapshot(repository);
  const capsule = snapshot.recoveryCapsule;
  const jobActive = useLaserStore((state) => isActiveJob(state.streamer));
  const [reviewOpen, setReviewOpen] = useState(false);
  // A pending Start may already have reached the controller. Never offer the
  // older capsule during the short owner lease; it returns only if arming is
  // cancelled, otherwise the candidate commits or reconciles as newest.
  if (jobActive || snapshot.pendingStart !== null || capsule === null) return null;

  return (
    <>
      <details style={bannerStyle} aria-label="Interrupted job recovery">
        <summary style={summaryStyle} title="Expand the isolated interrupted-job recovery options.">
          <strong>Interrupted job saved</strong>
          <span style={summaryDetailStyle}>
            {' '}
            · {capsule.artifact.machineKind === 'cnc' ? 'router' : 'laser'} · {capsule.ackedLines}{' '}
            of {capsule.sendableLines} lines acknowledged
          </span>
        </summary>
        <RecoveryDescription capsule={capsule} />
        <RecoveryActions
          capsule={capsule}
          repository={repository}
          disabled={props.busy}
          onReview={() => setReviewOpen(true)}
        />
      </details>
      {reviewOpen && capsule.artifact.machineKind === 'cnc' ? (
        <CncRecoveryPreviewWizard capsule={capsule} onClose={() => setReviewOpen(false)} />
      ) : null}
      {reviewOpen && capsule.artifact.machineKind === 'laser' ? (
        <LaserRecoveryReviewDialog
          capsule={capsule}
          onClose={() => setReviewOpen(false)}
          onStart={(saved) => runLaserRecoveryCapsuleFlow(saved, repository)}
        />
      ) : null}
    </>
  );
}

function RecoveryDescription({ capsule }: { readonly capsule: RecoveryCapsule }): JSX.Element {
  const startedAt = formatStartedAt(capsule.artifact.createdAtIso);
  const exact = capsule.artifact.kind === 'exact-execution';
  return (
    <div role="status">
      <p style={textStyle}>
        Saved {capsule.artifact.machineKind === 'cnc' ? 'router' : 'laser'} run
        {startedAt === null ? '' : ` from ${startedAt}`}. It is isolated from the current canvas,
        project, profile, controller settings, origins, and ordinary Start.
      </p>
      <p style={textStyle}>
        {exact
          ? 'Review uses the sealed exact G-code and prepared execution artifact. Archived controller observations are diagnostics only.'
          : 'This migrated legacy record contains only a fingerprint. Explicit review may use the current project only when its compiled fingerprint matches.'}
      </p>
      <p style={causeStyle}>
        <strong>Recorded cause:</strong> {capsule.interruption.message}
        {capsule.interruption.rejectedLine === undefined
          ? ''
          : ` Rejected command: ${capsule.interruption.rejectedLine}`}
      </p>
      {capsule.claim === undefined ? null : (
        <p style={causeStyle}>
          A recovery attempt was claimed at{' '}
          {formatStartedAt(capsule.claim.claimedAtIso) ?? 'an unknown time'}. Inspect the machine
          before discarding this record; another recovery cannot start from it.
        </p>
      )}
    </div>
  );
}

function RecoveryActions(props: {
  readonly capsule: RecoveryCapsule;
  readonly repository: RecoveryRepository;
  readonly disabled: boolean;
  readonly onReview: () => void;
}): JSX.Element {
  const discard = async (): Promise<void> => {
    if (
      !jobAwareConfirm(
        'Discard this interrupted-job recovery record?\n\nThis does not stop or move the machine. The current canvas and machine profile are unchanged.',
      )
    ) {
      return;
    }
    const result = await props.repository.discardRecovery({
      runId: props.capsule.runId,
      revision: props.capsule.revision,
    });
    if (!result.ok || !result.value) {
      jobAwareAlert(
        'The recovery record changed before it could be discarded. Review the current card.',
      );
    }
  };
  return (
    <div style={rowStyle}>
      <button
        type="button"
        disabled={props.disabled || props.capsule.claim !== undefined}
        onClick={props.onReview}
        title="Open a read-only review. No live state changes until final supervised Start."
      >
        {props.capsule.artifact.machineKind === 'cnc'
          ? 'Review supervised recovery'
          : 'Review recovery'}
      </button>
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => void discard()}
        title="Permanently discard only this isolated recovery capsule."
      >
        Discard
      </button>
    </div>
  );
}

function formatStartedAt(iso: string): string | null {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString();
}

const bannerStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '6px 8px',
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
const summaryDetailStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontWeight: 400,
};
const textStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '6px 0',
};
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const causeStyle: React.CSSProperties = {
  ...textStyle,
  color: 'var(--lf-warning)',
  fontWeight: 500,
};
