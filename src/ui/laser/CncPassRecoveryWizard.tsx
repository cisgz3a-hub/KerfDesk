// Pass-boundary CNC recovery wizard (ADR-215): one screen — what happened and
// how to extract the cutter, the pass map with the computed default boundary,
// the load-bearing physical checklist, and Start. The runway/segment wizard
// remains reachable as the advanced option (demoted per ADR-215 decision 4).

import { useMemo, useRef, useState } from 'react';
import { Dialog, DialogActions } from '../kit';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import type { RecoveryCapsule } from '../state/recovery';
import { CncPassRecoveryChecklist } from './CncPassRecoveryChecklist';
import { CncPassRecoveryPreview } from './CncPassRecoveryPreview';
import { CncRecoveryPreviewWizard } from './CncRecoveryPreviewWizard';
import { runCncPassRecoveryFlow } from './cnc-pass-recovery-flow';
import { cncExtractionGuidance } from './cnc-pass-recovery-guidance';
import { buildCncPassRecoveryModel } from './cnc-pass-recovery-model';
import { isLaterThanDefault, type CncPassRecoveryChecklistDraft } from './cnc-pass-recovery-review';

const EMPTY_CHECKLIST: CncPassRecoveryChecklistDraft = {
  cutterClear: false,
  spindleStopped: false,
  workholdingConfirmed: false,
  toolConfirmed: false,
  position: null,
};

export function CncPassRecoveryWizard(props: {
  readonly capsule: RecoveryCapsule;
  readonly onClose: () => void;
}): JSX.Element {
  const liveWco = useLaserStore((state) => state.wcoCache);
  const model = useMemo(
    () => buildCncPassRecoveryModel(props.capsule, liveWco),
    [props.capsule, liveWco],
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selection, setSelection] = useState<{ groupIndex: number; passIndex: number } | null>(
    model.kind === 'ready' ? model.defaultSelection : null,
  );
  const [checklist, setChecklist] = useState<CncPassRecoveryChecklistDraft>(EMPTY_CHECKLIST);
  const [starting, setStarting] = useState(false);
  const startInFlight = useRef(false);
  if (advancedOpen) {
    return <CncRecoveryPreviewWizard capsule={props.capsule} onClose={props.onClose} />;
  }
  const closeReadOnly = (): void => {
    if (!startInFlight.current) props.onClose();
  };
  const checklistComplete =
    checklist.cutterClear &&
    checklist.spindleStopped &&
    checklist.workholdingConfirmed &&
    checklist.toolConfirmed &&
    checklist.position !== null;
  const canStart = model.kind === 'ready' && selection !== null && checklistComplete && !starting;
  const startRecovery = async (): Promise<void> => {
    const position = checklist.position;
    if (!canStart || selection === null || position === null || startInFlight.current) return;
    startInFlight.current = true;
    setStarting(true);
    let started = false;
    try {
      started = await runCncPassRecoveryFlow(props.capsule, {
        ...checklist,
        position,
        ...selection,
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
    <Dialog title="CNC job recovery" size="lg" onClose={closeReadOnly}>
      <ExtractionGuidance capsule={props.capsule} />
      {model.kind === 'unavailable' ? (
        <div style={refusalStyle}>{model.reason}</div>
      ) : (
        <>
          <BoundarySection model={model} selection={selection} onSelect={setSelection} />
          <CncPassRecoveryChecklist
            checklist={checklist}
            retainedPositionIssue={model.retainedPositionIssue}
            onChange={setChecklist}
          />
        </>
      )}
      <WizardActions
        starting={starting}
        canStart={canStart}
        onClose={closeReadOnly}
        onAdvanced={() => setAdvancedOpen(true)}
        onStart={() => void startRecovery()}
      />
    </Dialog>
  );
}

function WizardActions(props: {
  readonly starting: boolean;
  readonly canStart: boolean;
  readonly onClose: () => void;
  readonly onAdvanced: () => void;
  readonly onStart: () => void;
}): JSX.Element {
  return (
    <DialogActions>
      <button
        type="button"
        disabled={props.starting}
        onClick={props.onClose}
        title="Close without moving the machine."
      >
        Close
      </button>
      <button
        type="button"
        disabled={props.starting}
        onClick={props.onAdvanced}
        title="Open the advanced mid-pass runway recovery review instead."
      >
        Advanced: mid-pass runway…
      </button>
      <button
        type="button"
        disabled={!props.canStart}
        onClick={props.onStart}
        title="Run the ordinary CNC Start gates, then stream the newly generated recovery job."
      >
        {props.starting ? 'Starting recovery…' : 'Start pass recovery'}
      </button>
    </DialogActions>
  );
}

function ExtractionGuidance({ capsule }: { readonly capsule: RecoveryCapsule }): JSX.Element {
  const guidance = cncExtractionGuidance(capsule.interruption.kind);
  return (
    <div style={guidanceStyle} role="alert">
      <strong>{guidance.title}.</strong> {guidance.spindleNote}
      <ul style={guidanceListStyle}>
        {guidance.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
    </div>
  );
}

function BoundarySection(props: {
  readonly model: Extract<ReturnType<typeof buildCncPassRecoveryModel>, { kind: 'ready' }>;
  readonly selection: { groupIndex: number; passIndex: number } | null;
  readonly onSelect: (selection: { groupIndex: number; passIndex: number }) => void;
}): JSX.Element {
  const { model, selection } = props;
  const laterThanDefault = selection !== null && isLaterThanDefault(selection, model.resumePoint);
  return (
    <div>
      <p style={bodyStyle}>
        Recovery starts a NEW job at the beginning of the selected pass: retract to safe Z, spindle
        up with its full spin-up dwell, rapid, plunge into the already-cut kerf, recut that pass,
        then continue all later work. Everything before the boundary is omitted and must already be
        complete.
      </p>
      <CncPassRecoveryPreview passes={model.passes} selected={selection} />
      <label style={fieldStyle}>
        Recovery boundary pass
        <select
          aria-label="CNC recovery boundary pass"
          title="Recovery recuts the selected pass from its start, then continues all later work."
          value={selection === null ? '' : `${selection.groupIndex}:${selection.passIndex}`}
          onChange={(event) => {
            const [groupIndex, passIndex] = event.currentTarget.value.split(':').map(Number);
            if (Number.isInteger(groupIndex) && Number.isInteger(passIndex)) {
              props.onSelect({ groupIndex: groupIndex ?? 0, passIndex: passIndex ?? 0 });
            }
          }}
        >
          {selection === null ? <option value="">Select a pass…</option> : null}
          {model.passes.map((pass) => (
            <option
              key={`${pass.groupIndex}:${pass.passIndex}`}
              value={`${pass.groupIndex}:${pass.passIndex}`}
            >
              {statusPrefix(pass.status, model, pass)} {pass.label}
            </option>
          ))}
        </select>
      </label>
      {model.defaultSelection === null ? (
        <p style={hintWarningStyle}>
          The sealed program could not be mapped onto passes, so no default boundary is computed.
          Select the earliest pass whose completion is uncertain.
        </p>
      ) : null}
      {laterThanDefault ? (
        <p style={hintWarningStyle}>
          Later than the computed safe boundary — starting here skips earlier work, and you will be
          asked to confirm that it is physically complete.
        </p>
      ) : null}
    </div>
  );
}

function statusPrefix(
  status: string,
  model: Extract<ReturnType<typeof buildCncPassRecoveryModel>, { kind: 'ready' }>,
  pass: { readonly groupIndex: number; readonly passIndex: number },
): string {
  const isDefault =
    model.defaultSelection?.groupIndex === pass.groupIndex &&
    model.defaultSelection.passIndex === pass.passIndex;
  if (isDefault) return '▶';
  if (status === 'proven-complete') return '✓';
  if (status === 'uncertain') return '?';
  return '·';
}

const guidanceStyle: React.CSSProperties = {
  border: '1px solid var(--lf-danger)',
  borderRadius: 6,
  padding: '9px 11px',
  color: 'var(--lf-danger)',
  fontSize: 12,
  lineHeight: 1.5,
};
const guidanceListStyle: React.CSSProperties = { margin: '6px 0 0', paddingLeft: 18 };
const bodyStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.5,
};
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: 5,
  fontSize: 12,
  fontWeight: 650,
  marginTop: 10,
};
const hintWarningStyle: React.CSSProperties = {
  color: 'var(--lf-warning)',
  fontSize: 11,
  fontWeight: 600,
};
const refusalStyle: React.CSSProperties = {
  borderLeft: '3px solid var(--lf-danger)',
  padding: '7px 9px',
  color: 'var(--lf-danger)',
  fontSize: 12,
  marginTop: 10,
};
