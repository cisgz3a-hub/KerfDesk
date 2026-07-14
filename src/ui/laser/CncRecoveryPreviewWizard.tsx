import { useMemo, useState } from 'react';
import type { JobCheckpoint } from '../../core/recovery';
import { Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { CncRecoveryRunwayPreview } from './CncRecoveryRunwayPreview';
import {
  buildCncRecoveryPreviewModel,
  CNC_RECOVERY_PREVIEW_PARAMETERS,
  type CncRecoveryEvidenceCheck,
} from './cnc-recovery-preview-model';

type WizardStep = 'evidence' | 'geometry' | 'decision';
const STEPS: ReadonlyArray<WizardStep> = ['evidence', 'geometry', 'decision'];

export function CncRecoveryPreviewWizard(props: {
  readonly checkpoint: JobCheckpoint;
  readonly onClose: () => void;
}): JSX.Element {
  const project = useStore((state) => state.project);
  const [step, setStep] = useState<WizardStep>('evidence');
  const [requestedEventId, setRequestedEventId] = useState<string>();
  const model = useMemo(
    () => buildCncRecoveryPreviewModel(project, props.checkpoint, requestedEventId),
    [project, props.checkpoint, requestedEventId],
  );
  const stepIndex = STEPS.indexOf(step);
  return (
    <Dialog title="CNC recovery review — preview only" size="lg" onClose={props.onClose}>
      <div style={warningStyle} role="alert">
        This wizard cannot start the spindle, emit recovery G-code, or move the machine. Use the
        physical E-stop or power isolation if the machine is unsafe.
      </div>
      <p style={stepLabelStyle}>
        Step {stepIndex + 1} of {STEPS.length}: {stepTitle(step)}
      </p>
      {step === 'evidence' ? <EvidenceStep checks={model.checks} /> : null}
      {step === 'geometry' ? (
        <GeometryStep model={model} onSelectEvent={setRequestedEventId} />
      ) : null}
      {step === 'decision' ? <DecisionStep unavailableReason={model.unavailableReason} /> : null}
      <DialogActions>
        <button type="button" onClick={props.onClose} title="Close the recovery preview.">
          Close
        </button>
        {stepIndex > 0 ? (
          <button
            type="button"
            onClick={() => setStep(STEPS[stepIndex - 1] ?? 'evidence')}
            title="Return to the previous review step."
          >
            Back
          </button>
        ) : null}
        {stepIndex < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep(STEPS[stepIndex + 1] ?? 'decision')}
            title="Continue to the next preview-only review step."
          >
            Next: {stepIndex === 0 ? 'Geometry' : 'Safety decision'}
          </button>
        ) : null}
      </DialogActions>
    </Dialog>
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
        Acknowledged lines are transport diagnostics. Automatic recovery would additionally require
        every missing proof below from trusted machine-side sources.
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
  readonly model: ReturnType<typeof buildCncRecoveryPreviewModel>;
  readonly onSelectEvent: (eventId: string) => void;
}): JSX.Element {
  const { model } = props;
  return (
    <div>
      <p style={bodyStyle}>
        Select a hypothetical uncertainty segment. This assumes earlier contour segments were
        cleared; it does not claim that the machine actually cut them.
      </p>
      {model.events.length > 0 ? (
        <label style={fieldStyle}>
          Hypothetical uncertainty segment
          <select
            aria-label="Hypothetical uncertainty segment"
            title="Choose a contour segment to visualize as a hypothetical uncertainty point."
            value={model.selectedEventId ?? ''}
            onChange={(event) => props.onSelectEvent(event.currentTarget.value)}
          >
            {model.events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p style={assumptionStyle}>
        Illustrative assumptions: {CNC_RECOVERY_PREVIEW_PARAMETERS.minRunwayMm} mm minimum runway,{' '}
        {CNC_RECOVERY_PREVIEW_PARAMETERS.accelerationMmPerSec2} mm/s² acceleration, and{' '}
        {CNC_RECOVERY_PREVIEW_PARAMETERS.safetyMarginMm} mm safety margin. These values are not a
        qualified machine profile.
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
        <div style={refusalStyle}>Preview refused: {model.geometry.reason}.</div>
      ) : null}
    </div>
  );
}

function DecisionStep({
  unavailableReason,
}: {
  readonly unavailableReason: string | null;
}): JSX.Element {
  return (
    <div>
      <h3 style={decisionTitleStyle}>Manual recovery remains required</h3>
      <p style={bodyStyle}>
        The preview is explanatory geometry, not permission to move. KerfDesk has no live recovery
        command, no generated recovery program, and no path from this dialog to the controller.
      </p>
      {unavailableReason === null ? null : <div style={refusalStyle}>{unavailableReason}</div>}
      <ul style={bodyStyle}>
        <li>Inspect the cutter, spindle, stock, fixture, and coordinates.</li>
        <li>Clear an embedded or damaged tool using the machine manufacturer’s procedure.</li>
        <li>Start only a separately reviewed new job after requalification.</li>
      </ul>
    </div>
  );
}

function stepTitle(step: WizardStep): string {
  if (step === 'evidence') return 'Evidence audit';
  if (step === 'geometry') return 'Hypothetical runway geometry';
  return 'Safety decision';
}

function statusLabel(status: CncRecoveryEvidenceCheck['status']): string {
  if (status === 'matched') return 'MATCHED';
  if (status === 'diagnostic') return 'DIAGNOSTIC';
  if (status === 'mismatch') return 'MISMATCH';
  return 'MISSING';
}

function statusStyle(status: CncRecoveryEvidenceCheck['status']): React.CSSProperties {
  const safe = status === 'matched';
  return {
    minWidth: 78,
    color: safe ? 'var(--lf-success)' : 'var(--lf-warning)',
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
  borderLeft: '3px solid var(--lf-warning)',
  background: 'var(--lf-bg-2)',
  padding: '8px 10px',
  marginBlock: 10,
  fontSize: 12,
};
const metricsStyle: React.CSSProperties = { ...bodyStyle, fontSize: 11, marginBottom: 0 };
const decisionTitleStyle: React.CSSProperties = { color: 'var(--lf-warning)', fontSize: 16 };
