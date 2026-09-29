import { useState } from 'react';
import { checkTwoPointRegistration } from '../../core/registration/registration-check';
import type { PrintAndCutDesignTargets, Vec2 } from '../../core/scene';
import { Button, Dialog, DialogActions, NumberInput } from '../kit';
import type { CaptureSource } from '../state/print-cut-session-store';

/** Finding both printed marks in one camera picture (ADR-443). */
export type PrintAndCutCamera = {
  /** A saved camera model: the dialog shows the camera row. */
  readonly offered: boolean;
  /** And a live camera, so there is a frame to capture. */
  readonly available: boolean;
  readonly finding: boolean;
  readonly message: string | null;
  readonly onFind: (targets: PrintAndCutDesignTargets) => void;
};

type PrintAndCutDialogProps = {
  readonly initialTargets: PrintAndCutDesignTargets;
  readonly firstMachinePoint: Vec2 | null;
  readonly secondMachinePoint: Vec2 | null;
  readonly firstSource?: CaptureSource | null;
  readonly secondSource?: CaptureSource | null;
  readonly captureEnabled: boolean;
  readonly captureFrameNotice?: string | null;
  readonly captureBasisError?: string | null;
  /** The centres of the two selected objects, when exactly two are selected. */
  readonly selectionTargets?: PrintAndCutDesignTargets | null;
  readonly camera?: PrintAndCutCamera;
  readonly onTargetsChanged?: () => void;
  readonly onCapture: (which: 'first' | 'second') => void;
  readonly onCancel: () => void;
  readonly onApply: (targets: PrintAndCutDesignTargets) => void;
  readonly onDisable: () => void;
};

export function PrintAndCutDialog(props: PrintAndCutDialogProps): JSX.Element {
  const [targets, setTargets] = useState(props.initialTargets);
  const registration = useRegistrationState(
    targets,
    props.firstMachinePoint,
    props.secondMachinePoint,
    props.captureBasisError ?? null,
  );
  const { invalidReason } = registration;
  const changeTargets = (next: PrintAndCutDesignTargets): void => {
    if (sameTargets(targets, next)) return;
    props.onTargetsChanged?.();
    setTargets(next);
  };
  const setCoordinate = (which: 'first' | 'second', axis: 'x' | 'y', value: string): void => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    changeTargets({ ...targets, [which]: { ...targets[which], [axis]: parsed } });
  };
  return (
    <Dialog
      title="Print and Cut"
      size="md"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        if (invalidReason !== null) return;
        props.onApply(targets);
      }}
    >
      {props.selectionTargets !== undefined ? (
        <SelectionTargetsRow selectionTargets={props.selectionTargets} onUse={changeTargets} />
      ) : null}
      <div style={gridStyle}>
        <TargetRow
          label="Target 1"
          target={targets.first}
          machine={props.firstMachinePoint}
          source={props.firstSource ?? null}
          captureEnabled={props.captureEnabled}
          onChange={(axis, value) => setCoordinate('first', axis, value)}
          onCapture={() => props.onCapture('first')}
        />
        <TargetRow
          label="Target 2"
          target={targets.second}
          machine={props.secondMachinePoint}
          source={props.secondSource ?? null}
          captureEnabled={props.captureEnabled}
          onChange={(axis, value) => setCoordinate('second', axis, value)}
          onCapture={() => props.onCapture('second')}
        />
      </div>
      {props.camera?.offered === true ? (
        <CameraMarksRow camera={props.camera} onFind={() => props.camera?.onFind(targets)} />
      ) : null}
      {props.captureFrameNotice != null ? (
        <p style={warningStyle}>{props.captureFrameNotice}</p>
      ) : null}
      <RegistrationStatus state={registration} />
      <DialogActions>
        <Button onClick={props.onDisable}>Disable</Button>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={invalidReason !== null}>
          Apply registration
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function sameTargets(a: PrintAndCutDesignTargets, b: PrintAndCutDesignTargets): boolean {
  return (
    a.first.x === b.first.x &&
    a.first.y === b.first.y &&
    a.second.x === b.second.x &&
    a.second.y === b.second.y
  );
}

export type RegistrationDraft = {
  /** Why the registration cannot be applied; null when it can. */
  readonly error: string | null;
  /** The captured spacing, print scale and turn, once both points are captured. */
  readonly measured: string | null;
  /** Why the operator must confirm it first (registration-check.ts); null when not. */
  readonly unusual: string | null;
};

export function registrationDraft(
  targets: PrintAndCutDesignTargets,
  firstMachinePoint: Vec2 | null,
  secondMachinePoint: Vec2 | null,
): RegistrationDraft {
  if (firstMachinePoint === null || secondMachinePoint === null) {
    return { error: 'Capture both machine registration points.', measured: null, unusual: null };
  }
  const checked = checkTwoPointRegistration({
    design: [targets.first, targets.second],
    machine: [firstMachinePoint, secondMachinePoint],
  });
  return checked.ok
    ? { error: null, measured: checked.measured, unusual: checked.unusual }
    : { error: checked.reason, measured: null, unusual: null };
}

type RegistrationState = {
  /** Why Apply is off; null when the registration can be applied. */
  readonly invalidReason: string | null;
  readonly measured: string | null;
  readonly unusual: string | null;
  readonly confirmedUnusual: boolean;
  readonly setConfirmed: (checked: boolean) => void;
};

function useRegistrationState(
  targets: PrintAndCutDesignTargets,
  first: Vec2 | null,
  second: Vec2 | null,
  basisError: string | null,
): RegistrationState {
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const draft = registrationDraft(targets, first, second);
  // Points captured in different bases measure nothing.
  const measured = basisError === null ? draft.measured : null;
  const unusual = basisError === null ? draft.unusual : null;
  // A confirmation holds for the figures it was given for; any change asks again.
  const key = unusual === null ? null : `${measured} ${unusual}`;
  const confirmedUnusual = key !== null && confirmed === key;
  const unconfirmed = unusual !== null && !confirmedUnusual ? unusual : null;
  return {
    invalidReason: basisError ?? draft.error ?? unconfirmed,
    measured,
    unusual,
    confirmedUnusual,
    setConfirmed: (checked) => setConfirmed(checked ? key : null),
  };
}

function RegistrationStatus(props: { readonly state: RegistrationState }): JSX.Element {
  const { state } = props;
  return (
    <>
      {state.measured !== null ? <p style={measuredStyle}>{state.measured}</p> : null}
      {state.unusual !== null ? (
        <UnusualRegistrationRow
          reason={state.unusual}
          confirmed={state.confirmedUnusual}
          onConfirm={state.setConfirmed}
        />
      ) : state.invalidReason !== null ? (
        <p style={warningStyle}>{state.invalidReason}</p>
      ) : null}
    </>
  );
}

// Targets too close together, an unusual scale or a turn near 180° is more
// often a capture mistake than the sheet, so the dialog applies it only once
// the operator ticks the box (ADR-443 Amendment 1). Output still uses what was
// captured; Job Review repeats the note at Start.
function UnusualRegistrationRow(props: {
  readonly reason: string;
  readonly confirmed: boolean;
  readonly onConfirm: (checked: boolean) => void;
}): JSX.Element {
  return (
    <div style={unusualStyle}>
      <p style={{ ...warningStyle, margin: 0 }}>{props.reason}</p>
      <label style={confirmStyle}>
        <input
          type="checkbox"
          className="lf-checkbox"
          checked={props.confirmed}
          onChange={(event) => props.onConfirm(event.currentTarget.checked)}
        />
        <span>Use this registration anyway</span>
      </label>
    </div>
  );
}

function TargetRow(props: {
  readonly label: string;
  readonly target: Vec2;
  readonly machine: Vec2 | null;
  readonly source: CaptureSource | null;
  readonly captureEnabled: boolean;
  readonly onChange: (axis: 'x' | 'y', value: string) => void;
  readonly onCapture: () => void;
}): JSX.Element {
  return (
    <fieldset style={fieldsetStyle}>
      <legend>{props.label}</legend>
      <label style={fieldStyle}>
        <span>Design X</span>
        <NumberInput
          value={String(props.target.x)}
          step={0.1}
          onChange={(event) => props.onChange('x', event.currentTarget.value)}
        />
      </label>
      <label style={fieldStyle}>
        <span>Design Y</span>
        <NumberInput
          value={String(props.target.y)}
          step={0.1}
          onChange={(event) => props.onChange('y', event.currentTarget.value)}
        />
      </label>
      <div style={captureStyle}>
        <span>{capturedLabel(props.machine, props.source)}</span>
        <Button disabled={!props.captureEnabled} onClick={props.onCapture}>
          Capture head
        </Button>
      </div>
    </fieldset>
  );
}

function capturedLabel(point: Vec2 | null, source: CaptureSource | null): string {
  if (point === null) return 'Not captured';
  return source === 'camera'
    ? `Camera ${point.x.toFixed(2)}, ${point.y.toFixed(2)}`
    : `Machine ${point.x.toFixed(3)}, ${point.y.toFixed(3)}`;
}

// Sets both design targets to the centres of the two selected objects, which
// are normally the two marks drawn in the design.
function SelectionTargetsRow(props: {
  readonly selectionTargets: PrintAndCutDesignTargets | null;
  readonly onUse: (targets: PrintAndCutDesignTargets) => void;
}): JSX.Element {
  const [hint, setHint] = useState<string | null>(null);
  return (
    <div style={selectionRowStyle}>
      <Button
        onClick={() => {
          if (props.selectionTargets === null) {
            setHint('Select the two marks in the design first, then use them as the targets.');
            return;
          }
          setHint(null);
          props.onUse(props.selectionTargets);
        }}
      >
        Use selected marks
      </Button>
      <span style={noteStyle}>
        {hint ?? 'Targets at the centres of the two selected objects, the left one first.'}
      </span>
    </div>
  );
}

function CameraMarksRow(props: {
  readonly camera: PrintAndCutCamera;
  readonly onFind: () => void;
}): JSX.Element {
  const { camera } = props;
  const note = camera.available
    ? 'Finds both printed marks in one camera picture, at the material height set in the Camera panel.'
    : 'Turn the camera on in the Camera panel to find the marks with it.';
  return (
    <div style={cameraStyle}>
      <div style={rowStyle}>
        <Button disabled={!camera.available || camera.finding} onClick={props.onFind}>
          {camera.finding ? 'Finding marks…' : 'Find marks with camera'}
        </Button>
        <span style={noteStyle}>{note}</span>
      </div>
      {camera.message !== null ? (
        <p role="status" style={messageStyle}>
          {camera.message}
        </p>
      ) : null}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};
const selectionRowStyle: React.CSSProperties = { ...rowStyle, margin: '0 0 10px' };
const cameraStyle: React.CSSProperties = { display: 'grid', gap: 4, margin: '10px 0 0' };
const noteStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const messageStyle: React.CSSProperties = { fontSize: 12, margin: 0 };
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const fieldsetStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  border: '1px solid var(--lf-border)',
};
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 90px',
  alignItems: 'center',
  gap: 8,
};
const captureStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
const warningStyle: React.CSSProperties = {
  color: 'var(--lf-warning-fg)',
  fontSize: 12,
  margin: '8px 0 0',
};
const measuredStyle: React.CSSProperties = { fontSize: 12, margin: '8px 0 0' };
const unusualStyle: React.CSSProperties = { display: 'grid', gap: 6, margin: '8px 0 0' };
const confirmStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
