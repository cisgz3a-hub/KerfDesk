import { useRef, useState } from 'react';
import { assertNever } from '../../core/scene';
import type { RecoveryCapsule } from '../state/recovery';
import { Dialog, DialogActions } from '../kit';

export type LaserRecoveryReviewDialogProps = {
  readonly capsule: RecoveryCapsule;
  readonly onClose: () => void;
  readonly onStart: (capsule: RecoveryCapsule) => Promise<boolean>;
};

/**
 * A deliberately sealed review surface for an interrupted laser run.
 *
 * This component owns presentation state only. Reading the current project,
 * controller stores, or the recovery repository here would let opening the
 * review change the live session before the operator makes the final choice.
 */
export function LaserRecoveryReviewDialog(props: LaserRecoveryReviewDialogProps): JSX.Element {
  const start = useRecoveryStart(props);
  return (
    <Dialog title="Review interrupted laser job" size="md" onClose={start.closeReadOnly}>
      <RecoveryReviewContent capsule={props.capsule} />
      {start.state === 'failed' ? (
        <div role="alert" aria-live="polite" style={failureStyle}>
          {start.failureMessage}
        </div>
      ) : null}
      <RecoveryActions
        state={start.state}
        onClose={start.closeReadOnly}
        onStart={() => void start.startRecovery()}
      />
    </Dialog>
  );
}

type RecoveryStartState = 'idle' | 'starting' | 'failed';

function useRecoveryStart(props: LaserRecoveryReviewDialogProps): {
  readonly state: RecoveryStartState;
  readonly failureMessage: string;
  readonly closeReadOnly: () => void;
  readonly startRecovery: () => Promise<void>;
} {
  const [state, setState] = useState<RecoveryStartState>('idle');
  const [failureMessage, setFailureMessage] = useState('');
  const startInFlight = useRef(false);
  const closeReadOnly = (): void => {
    if (!startInFlight.current) props.onClose();
  };
  const startRecovery = async (): Promise<void> => {
    if (startInFlight.current) return;
    startInFlight.current = true;
    setFailureMessage('');
    setState('starting');
    try {
      if (await props.onStart(props.capsule)) {
        props.onClose();
        return;
      }
      setFailureMessage(
        'Recovery was not started. Review the current recovery card and live controller state before trying again.',
      );
    } catch (error: unknown) {
      setFailureMessage(failureFrom(error));
    }
    startInFlight.current = false;
    setState('failed');
  };
  return { state, failureMessage, closeReadOnly, startRecovery };
}

function RecoveryReviewContent({ capsule }: { readonly capsule: RecoveryCapsule }): JSX.Element {
  return (
    <>
      <div style={noticeStyle}>
        Reviewing or closing this saved job does not change the current canvas, project, machine
        profile, controller settings, origin, or G-code.
      </div>
      <ArtifactSummary capsule={capsule} />
      <TransportProgress capsule={capsule} />
      <InterruptionDiagnostics capsule={capsule} />
      <div style={safetyStyle} role="note">
        Starting recovery requires a freshly qualified, matching controller before transmission.
        Archived settings are never written to firmware. Confirm the machine is physically safe and
        the interrupted work still matches this saved run.
      </div>
    </>
  );
}

function TransportProgress({ capsule }: { readonly capsule: RecoveryCapsule }): JSX.Element {
  const remainingLines = Math.max(0, capsule.sendableLines - capsule.ackedLines);
  return (
    <section aria-labelledby="laser-recovery-progress-title" style={sectionStyle}>
      <h3 id="laser-recovery-progress-title" style={sectionTitleStyle}>
        Transport progress
      </h3>
      <p style={progressStyle}>
        <strong>{formatCount(capsule.ackedLines)}</strong> of{' '}
        <strong>{formatCount(capsule.sendableLines)}</strong> sendable lines acknowledged
        {remainingLines > 0 ? ` / ${formatCount(remainingLines)} remaining` : ''}
      </p>
      <p style={diagnosticNoteStyle}>
        Controller acknowledgements are diagnostic evidence only. They do not prove where the head
        moved or which laser marks physically completed.
      </p>
    </section>
  );
}

function InterruptionDiagnostics({ capsule }: { readonly capsule: RecoveryCapsule }): JSX.Element {
  return (
    <section aria-labelledby="laser-recovery-interruption-title" style={sectionStyle}>
      <h3 id="laser-recovery-interruption-title" style={sectionTitleStyle}>
        Why the run was saved
      </h3>
      <dl style={diagnosticListStyle}>
        <DiagnosticRow label="Cause">{interruptionLabel(capsule.interruption.kind)}</DiagnosticRow>
        <DiagnosticRow label="Detail">{capsule.interruption.message}</DiagnosticRow>
        {capsule.interruption.rejectedLine === undefined ? null : (
          <DiagnosticRow label="Rejected line">
            <code>{capsule.interruption.rejectedLine}</code>
          </DiagnosticRow>
        )}
      </dl>
    </section>
  );
}

function DiagnosticRow(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={diagnosticRowStyle}>
      <dt style={termStyle}>{props.label}</dt>
      <dd style={descriptionStyle}>{props.children}</dd>
    </div>
  );
}

function RecoveryActions(props: {
  readonly state: RecoveryStartState;
  readonly onClose: () => void;
  readonly onStart: () => void;
}): JSX.Element {
  const starting = props.state === 'starting';
  return (
    <DialogActions>
      <button
        type="button"
        disabled={starting}
        onClick={props.onClose}
        title="Close this review without changing the live job or controller."
      >
        Close
      </button>
      <button
        type="button"
        disabled={starting}
        onClick={props.onStart}
        title="Run fresh safety checks, then start this saved laser job under supervised recovery."
      >
        {starting ? 'Starting supervised recovery...' : 'Start supervised recovery'}
      </button>
    </DialogActions>
  );
}

function ArtifactSummary({ capsule }: { readonly capsule: RecoveryCapsule }): JSX.Element {
  if (capsule.artifact.kind === 'legacy-fingerprint-only') {
    return (
      <section aria-labelledby="laser-recovery-artifact-title" style={sectionStyle}>
        <h3 id="laser-recovery-artifact-title" style={sectionTitleStyle}>
          Legacy fingerprint-only record
        </h3>
        <p style={bodyStyle}>
          This older record does not contain the exact emitted G-code. Explicit recovery can
          continue only if the current project compiles to the same fingerprint. Nothing is imported
          into the open project automatically.
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="laser-recovery-artifact-title" style={sectionStyle}>
      <h3 id="laser-recovery-artifact-title" style={sectionTitleStyle}>
        Exact job artifact saved
      </h3>
      <p style={bodyStyle}>
        The exact emitted G-code and streaming configuration are sealed in this recovery capsule.
        Recovery uses that archived job without replacing the current canvas or project.
      </p>
      <p style={diagnosticNoteStyle}>
        Its controller observation from{' '}
        {formatTimestamp(capsule.artifact.archivedControllerObservation.observedAtIso)} is retained
        for diagnostics only.
      </p>
    </section>
  );
}

function interruptionLabel(kind: RecoveryCapsule['interruption']['kind']): string {
  switch (kind) {
    case 'disconnect':
      return 'Connection lost';
    case 'controller-error':
      return 'Controller rejected the run';
    case 'write-failed':
      return 'Transport write failed';
    case 'controller-reboot':
      return 'Controller restarted';
    case 'stream-stalled':
      return 'Stream stopped responding';
    case 'cancelled':
      return 'Run was cancelled';
    case 'unknown':
      return 'Unknown interruption';
    default:
      return assertNever(kind, 'job interruption kind');
  }
}

function failureFrom(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'Recovery was not started. Review the current recovery card before trying again.';
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

const noticeStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: '9px 11px',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.45,
};
const sectionStyle: React.CSSProperties = { marginTop: 14 };
const sectionTitleStyle: React.CSSProperties = { fontSize: 13, margin: '0 0 5px' };
const bodyStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.5,
  margin: 0,
};
const progressStyle: React.CSSProperties = { fontSize: 12, margin: '0 0 4px' };
const diagnosticNoteStyle: React.CSSProperties = {
  ...bodyStyle,
  fontSize: 11,
};
const diagnosticListStyle: React.CSSProperties = { margin: 0 };
const diagnosticRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr',
  gap: 8,
  padding: '3px 0',
  fontSize: 12,
};
const termStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontWeight: 650 };
const descriptionStyle: React.CSSProperties = { margin: 0, overflowWrap: 'anywhere' };
const safetyStyle: React.CSSProperties = {
  borderLeft: '3px solid var(--lf-warning)',
  marginTop: 14,
  padding: '7px 9px',
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.45,
};
const failureStyle: React.CSSProperties = {
  borderLeft: '3px solid var(--lf-danger)',
  marginTop: 10,
  padding: '7px 9px',
  color: 'var(--lf-danger)',
  fontSize: 12,
};
