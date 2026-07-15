import { useMemo, useRef, useState } from 'react';
import { Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { RecoveryCapsule } from '../state/recovery';
import {
  CncRecoveryQualificationStep,
  isCncRecoveryReviewComplete,
  type CncRecoveryReviewDraft,
} from './CncRecoveryQualificationStep';
import { CncRecoveryRunwayPreview } from './CncRecoveryRunwayPreview';
import { runCncSupervisedRecoveryFlow } from './cnc-supervised-recovery-flow';
import {
  buildCncRecoveryPreviewModel,
  buildLegacyFingerprintOnlyCncRecoveryPreviewModel,
  type CncRecoveryEvidenceCheck,
  type CncRecoveryPreviewModel,
} from './cnc-recovery-preview-model';

type WizardStep = 'evidence' | 'geometry' | 'qualification' | 'decision';
const STEPS: ReadonlyArray<WizardStep> = ['evidence', 'geometry', 'qualification', 'decision'];
const EMPTY_REVIEW: CncRecoveryReviewDraft = {
  qualificationId: '',
  cutterClear: false,
  spindleStopped: false,
  positionRequalified: false,
  toolInspected: false,
  workholdingConfirmed: false,
  priorWorkConfirmed: false,
  clearedPathConfirmed: false,
};

export function CncRecoveryPreviewWizard(props: {
  readonly capsule: RecoveryCapsule;
  readonly onClose: () => void;
}): JSX.Element {
  const project = useStore((state) => state.project);
  const [step, setStep] = useState<WizardStep>('evidence');
  const [requestedEventId, setRequestedEventId] = useState('');
  const [review, setReview] = useState<CncRecoveryReviewDraft>(EMPTY_REVIEW);
  const [starting, setStarting] = useState(false);
  const startInFlight = useRef(false);
  const model = useMemo(() => {
    const eventId = requestedEventId === '' ? undefined : requestedEventId;
    return props.capsule.artifact.kind === 'exact-execution'
      ? buildCncRecoveryPreviewModel(props.capsule, eventId)
      : buildLegacyFingerprintOnlyCncRecoveryPreviewModel(project, props.capsule, eventId);
  }, [project, props.capsule, requestedEventId]);
  const stepIndex = STEPS.indexOf(step);
  const reviewComplete = isCncRecoveryReviewComplete(review);
  const canStart = model.canExecute && reviewComplete && !starting;
  const closeReadOnly = (): void => {
    if (!startInFlight.current) props.onClose();
  };
  const selectEvent = (eventId: string): void => {
    if (eventId === requestedEventId) return;
    setRequestedEventId(eventId);
    setReview((current) => ({
      ...current,
      priorWorkConfirmed: false,
      clearedPathConfirmed: false,
    }));
  };
  const startRecovery = async (): Promise<void> => {
    if (!canStart || model.selectedEventId === null || startInFlight.current) return;
    startInFlight.current = true;
    setStarting(true);
    let started = false;
    try {
      started = await runCncSupervisedRecoveryFlow(props.capsule, {
        ...review,
        uncertaintyEventId: model.selectedEventId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      jobAwareAlert(`Cannot start CNC recovery:\n\n${message}`);
    } finally {
      startInFlight.current = false;
      setStarting(false);
    }
    if (started) props.onClose();
  };
  return (
    <Dialog title="Supervised CNC recovery" size="lg" onClose={closeReadOnly}>
      <RecoverySafetyWarning />
      <p style={stepLabelStyle}>
        Step {stepIndex + 1} of {STEPS.length}: {stepTitle(step)}
      </p>
      {step === 'evidence' ? <EvidenceStep checks={model.checks} /> : null}
      {step === 'geometry' ? <GeometryStep model={model} onSelectEvent={selectEvent} /> : null}
      {step === 'qualification' ? (
        <CncRecoveryQualificationStep review={review} onChange={setReview} />
      ) : null}
      {step === 'decision' ? (
        <DecisionStep model={model} qualificationId={review.qualificationId} />
      ) : null}
      <RecoveryWizardActions
        step={step}
        stepIndex={stepIndex}
        model={model}
        reviewComplete={reviewComplete}
        canStart={canStart}
        starting={starting}
        onClose={closeReadOnly}
        onStep={setStep}
        onStart={() => void startRecovery()}
      />
    </Dialog>
  );
}

function RecoveryWizardActions(props: {
  readonly step: WizardStep;
  readonly stepIndex: number;
  readonly model: CncRecoveryPreviewModel;
  readonly reviewComplete: boolean;
  readonly canStart: boolean;
  readonly starting: boolean;
  readonly onClose: () => void;
  readonly onStep: (step: WizardStep) => void;
  readonly onStart: () => void;
}): JSX.Element {
  return (
    <DialogActions>
      <button
        type="button"
        disabled={props.starting}
        onClick={props.onClose}
        title={
          props.starting
            ? 'Wait for the supervised recovery start attempt to finish.'
            : 'Close without moving the machine.'
        }
      >
        Close
      </button>
      {props.stepIndex > 0 ? (
        <button
          type="button"
          disabled={props.starting}
          onClick={() => props.onStep(STEPS[props.stepIndex - 1] ?? 'evidence')}
          title="Return to the previous recovery review step."
        >
          Back
        </button>
      ) : null}
      {props.stepIndex < STEPS.length - 1 ? (
        <button
          type="button"
          disabled={nextDisabled(props.step, props.model, props.reviewComplete)}
          onClick={() => props.onStep(STEPS[props.stepIndex + 1] ?? 'decision')}
          title="Continue after completing every requirement on this recovery review step."
        >
          Next: {nextStepLabel(props.step)}
        </button>
      ) : (
        <button
          type="button"
          disabled={!props.canStart}
          onClick={props.onStart}
          title="Run the ordinary CNC Start gates again, then stream the newly generated recovery job."
        >
          {props.starting ? 'Starting recovery…' : 'Start supervised recovery'}
        </button>
      )}
    </DialogActions>
  );
}

function RecoverySafetyWarning(): JSX.Element {
  return (
    <div style={warningStyle} role="alert">
      This flow can move the machine only after physical clearance and requalification. If the
      cutter is embedded or the machine is unsafe, use the physical E-stop or power isolation and
      recover it manually first.
    </div>
  );
}

function EvidenceStep({
  checks,
}: {
  readonly checks: ReadonlyArray<CncRecoveryEvidenceCheck>;
}): JSX.Element {
  return (
    <div>
      <p style={bodyStyle}>
        Acknowledged lines remain transport diagnostics. This flow never turns that count into a cut
        position; you explicitly select the first uncertain native contour segment in the next step.
      </p>
      <ul style={checkListStyle}>
        {checks.map((check) => (
          <li key={check.id} style={checkStyle}>
            <span style={statusStyle(check.status)}>{statusLabel(check.status)}</span>
            <span>
              <strong>{check.label}</strong>
              <br />
              <span style={detailStyle}>{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GeometryStep(props: {
  readonly model: CncRecoveryPreviewModel;
  readonly onSelectEvent: (eventId: string) => void;
}): JSX.Element {
  const { model } = props;
  return (
    <div>
      <p style={bodyStyle}>
        Select the first segment whose completed cut is uncertain. The displayed lead-in may be used
        only after you physically confirm that its preceding tangent is already clear.
      </p>
      {model.events.length > 0 ? (
        <label style={fieldStyle}>
          First uncertain contour segment
          <select
            aria-label="First uncertain CNC contour segment"
            title="Choose the first native contour segment whose completed cut is uncertain."
            value={model.selectedEventId ?? ''}
            onChange={(event) => props.onSelectEvent(event.currentTarget.value)}
          >
            <option value="">Select a segment…</option>
            {model.events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p style={assumptionStyle}>
        Recovery profile: {model.parameters.minRunwayMm} mm minimum runway,{' '}
        {model.parameters.accelerationMmPerSec2} mm/s² conservative acceleration, and{' '}
        {model.parameters.safetyMarginMm} mm margin. Execution requires a machine-specific air-cut
        or scrap-test qualification record.
      </p>
      {model.unavailableReason !== null ? (
        <div style={refusalStyle}>{model.unavailableReason}</div>
      ) : null}
      {model.geometry?.kind === 'preview' ? (
        <>
          <CncRecoveryRunwayPreview preview={model.geometry} />
          <p style={metricsStyle}>
            Required runway: {formatMm(model.geometry.requiredRunwayMm)} · Available straight
            tangent: {formatMm(model.geometry.availableClearedMm)} · Programmed feed:{' '}
            {model.geometry.feedMmPerMin} mm/min · Cut Z: {model.geometry.cutZMm} mm
          </p>
        </>
      ) : null}
      {model.geometry?.kind === 'error' ? (
        <div style={refusalStyle}>Recovery refused: {model.geometry.reason}.</div>
      ) : null}
    </div>
  );
}

function DecisionStep(props: {
  readonly model: CncRecoveryPreviewModel;
  readonly qualificationId: string;
}): JSX.Element {
  const geometry = props.model.geometry;
  return (
    <div>
      <h3 style={decisionTitleStyle}>A new recovery job will be generated</h3>
      <p style={bodyStyle}>
        KerfDesk will recompile and fingerprint the original project again, bind the selected
        semantic segment and qualification into a SHA-256 package, then run the normal CNC Start
        gates. The new job retracts to safe Z, starts and dwells the spindle, enters at the
        confirmed-clear runway, and continues the selected pass plus all later work. Everything
        before the selected segment is omitted and must be known complete.
      </p>
      {geometry?.kind === 'preview' ? (
        <ul style={bodyStyle}>
          <li>Selected event: {geometry.eventId}</li>
          <li>Required confirmed-clear runway: {formatMm(geometry.requiredRunwayMm)}</li>
          <li>Qualification record: {props.qualificationId.trim()}</li>
        </ul>
      ) : (
        <div style={refusalStyle}>No executable recovery geometry is selected.</div>
      )}
    </div>
  );
}

function nextDisabled(
  step: WizardStep,
  model: CncRecoveryPreviewModel,
  reviewComplete: boolean,
): boolean {
  if (step === 'geometry') return !model.canExecute;
  if (step === 'qualification') return !reviewComplete;
  return false;
}

function stepTitle(step: WizardStep): string {
  if (step === 'evidence') return 'Evidence audit';
  if (step === 'geometry') return 'Select uncertainty and runway';
  if (step === 'qualification') return 'Physical requalification';
  return 'Final recovery-job review';
}

function nextStepLabel(step: WizardStep): string {
  if (step === 'evidence') return 'Geometry';
  if (step === 'geometry') return 'Physical checks';
  return 'Final review';
}

function statusLabel(status: CncRecoveryEvidenceCheck['status']): string {
  if (status === 'matched') return 'MATCHED';
  if (status === 'diagnostic') return 'DIAGNOSTIC';
  if (status === 'mismatch') return 'MISMATCH';
  return 'MISSING';
}

function statusStyle(status: CncRecoveryEvidenceCheck['status']): React.CSSProperties {
  return {
    minWidth: 78,
    color: status === 'matched' ? 'var(--lf-success)' : 'var(--lf-warning)',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.04em',
  };
}

function formatMm(value: number): string {
  return `${value.toFixed(2)} mm`;
}

const warningStyle: React.CSSProperties = {
  border: '1px solid var(--lf-danger)',
  borderRadius: 6,
  padding: '9px 11px',
  color: 'var(--lf-danger)',
  fontWeight: 650,
  fontSize: 12,
};
const stepLabelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, marginBlock: 14 };
const bodyStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.5,
};
const checkListStyle: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };
const checkStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  padding: '8px 0',
  borderBottom: '1px solid var(--lf-border)',
};
const detailStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 11 };
const fieldStyle: React.CSSProperties = { display: 'grid', gap: 5, fontSize: 12, fontWeight: 650 };
const assumptionStyle: React.CSSProperties = { ...bodyStyle, fontSize: 11 };
const refusalStyle: React.CSSProperties = {
  borderLeft: '3px solid var(--lf-danger)',
  padding: '7px 9px',
  color: 'var(--lf-danger)',
  fontSize: 12,
};
const metricsStyle: React.CSSProperties = { ...bodyStyle, fontFamily: 'monospace', fontSize: 11 };
const decisionTitleStyle: React.CSSProperties = { fontSize: 14, marginBlock: '0 8px' };
