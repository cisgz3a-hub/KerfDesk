import { useState } from 'react';
import { solveTwoPointRegistration } from '../../core/registration';
import type { PrintAndCutDesignTargets, Vec2 } from '../../core/scene';
import { Button, Dialog, DialogActions, NumberInput } from '../kit';

export function PrintAndCutDialog(props: {
  readonly initialTargets: PrintAndCutDesignTargets;
  readonly firstMachinePoint: Vec2 | null;
  readonly secondMachinePoint: Vec2 | null;
  readonly captureEnabled: boolean;
  readonly onCapture: (which: 'first' | 'second') => void;
  readonly onCancel: () => void;
  readonly onApply: (targets: PrintAndCutDesignTargets) => void;
  readonly onDisable: () => void;
}): JSX.Element {
  const [targets, setTargets] = useState(props.initialTargets);
  const invalidReason = registrationDraftError(
    targets,
    props.firstMachinePoint,
    props.secondMachinePoint,
  );
  const setCoordinate = (which: 'first' | 'second', axis: 'x' | 'y', value: string): void => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setTargets((current) => ({ ...current, [which]: { ...current[which], [axis]: parsed } }));
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
      <div style={gridStyle}>
        <TargetRow
          label="Target 1"
          target={targets.first}
          machine={props.firstMachinePoint}
          captureEnabled={props.captureEnabled}
          onChange={(axis, value) => setCoordinate('first', axis, value)}
          onCapture={() => props.onCapture('first')}
        />
        <TargetRow
          label="Target 2"
          target={targets.second}
          machine={props.secondMachinePoint}
          captureEnabled={props.captureEnabled}
          onChange={(axis, value) => setCoordinate('second', axis, value)}
          onCapture={() => props.onCapture('second')}
        />
      </div>
      {invalidReason !== null ? <p style={warningStyle}>{invalidReason}</p> : null}
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

export function registrationDraftError(
  targets: PrintAndCutDesignTargets,
  firstMachinePoint: Vec2 | null,
  secondMachinePoint: Vec2 | null,
): string | null {
  if (firstMachinePoint === null || secondMachinePoint === null) {
    return 'Capture both machine registration points.';
  }
  const solved = solveTwoPointRegistration({
    design: [targets.first, targets.second],
    machine: [firstMachinePoint, secondMachinePoint],
  });
  return solved.ok ? null : solved.reason;
}

function TargetRow(props: {
  readonly label: string;
  readonly target: Vec2;
  readonly machine: Vec2 | null;
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
        <span>
          {props.machine === null
            ? 'Not captured'
            : `Machine ${props.machine.x.toFixed(3)}, ${props.machine.y.toFixed(3)}`}
        </span>
        <Button disabled={!props.captureEnabled} onClick={props.onCapture}>
          Capture head
        </Button>
      </div>
    </fieldset>
  );
}

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
  color: 'var(--lf-warning)',
  fontSize: 12,
  margin: '8px 0 0',
};
