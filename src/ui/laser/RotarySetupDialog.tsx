import { useState } from 'react';
import {
  DEFAULT_ROTARY_SETUP,
  rotaryCircumferenceMm,
  rotaryMeasurementsValid,
  rotaryUsesRollerDiameter,
  rotaryYLimitMm,
  rotaryYScale,
  type RotarySetup,
} from '../../core/devices/rotary';
import { Button, Dialog, DialogActions } from '../kit';
import { errorStyle, previewStyle } from './rotary-setup-dialog.styles';
import { startRotaryEdit } from './rotary-setup-edit';
import { RotarySetupFields } from './RotarySetupFields';
import { RotaryTestRotationPanel } from './RotaryTestRotationPanel';
import { useRotaryTestRotation } from './use-rotary-test-rotation';

export function RotarySetupDialog(props: {
  readonly setup: RotarySetup | undefined;
  readonly onCancel: () => void;
  readonly onApply: (setup: RotarySetup) => void;
  readonly onGenerateCalibration: (setup: RotarySetup) => void;
}): JSX.Element {
  const [edit, setEdit] = useState(() => startRotaryEdit(props.setup ?? DEFAULT_ROTARY_SETUP));
  const test = useRotaryTestRotation();
  const { setup } = edit;
  const valid = rotaryMeasurementsValid(setup);
  return (
    <Dialog title="Rotary Setup" size="md" onClose={props.onCancel}>
      <RotarySetupFields edit={edit} onEdit={setEdit} />
      <RotaryPreview setup={setup} valid={valid} />
      {!valid ? (
        <p style={errorStyle}>Diameters and motion per turn must be greater than zero.</p>
      ) : null}
      <RotaryTestRotationPanel setup={setup} valid={valid} test={test} />
      <RotaryActions
        setup={setup}
        valid={valid}
        testing={test.view.kind === 'running'}
        onCancel={props.onCancel}
        onApply={props.onApply}
        onGenerateCalibration={props.onGenerateCalibration}
      />
    </Dialog>
  );
}

// The wrap limit is one revolution: artwork taller than the circumference
// would overlap itself, and the machine sees it as the Y travel below.
function RotaryPreview(props: {
  readonly setup: RotarySetup;
  readonly valid: boolean;
}): JSX.Element {
  const circumference = props.valid ? rotaryCircumferenceMm(props.setup) : 0;
  const machineWrap = props.valid ? rotaryYLimitMm(props.setup) : 0;
  const scale = props.valid ? rotaryYScale(props.setup) : 1;
  const unscaledRoller = props.setup.type === 'roller' && !rotaryUsesRollerDiameter(props.setup);
  return (
    <div style={previewStyle} aria-label="Rotary wrap preview">
      <span>Surface circumference: {circumference.toFixed(2)} mm</span>
      <span>Machine travel per revolution: {machineWrap.toFixed(2)} mm</span>
      <span>
        Y scale: ×{scale.toFixed(4)}{' '}
        {unscaledRoller ? '(Y moves the surface directly)' : 'machine mm per surface mm'}
      </span>
      <span>Wrap limit: artwork up to {circumference.toFixed(2)} mm tall fits one revolution</span>
    </div>
  );
}

function RotaryActions(props: {
  readonly setup: RotarySetup;
  readonly valid: boolean;
  readonly testing: boolean;
  readonly onCancel: () => void;
  readonly onApply: (setup: RotarySetup) => void;
  readonly onGenerateCalibration: (setup: RotarySetup) => void;
}): JSX.Element {
  const ready = props.valid && !props.testing;
  return (
    <DialogActions>
      <Button onClick={props.onCancel}>Cancel</Button>
      <Button
        disabled={!ready || !props.setup.enabled}
        onClick={() => props.onGenerateCalibration(props.setup)}
      >
        Generate test pattern
      </Button>
      <Button variant="primary" disabled={!ready} onClick={() => props.onApply(props.setup)}>
        Apply
      </Button>
    </DialogActions>
  );
}
