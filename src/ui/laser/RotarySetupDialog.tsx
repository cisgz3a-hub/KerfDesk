import { useState } from 'react';
import {
  DEFAULT_ROTARY_SETUP,
  rotaryMeasurementsValid,
  type RotarySetup,
} from '../../core/devices/rotary';
import type { RotaryPreset } from '../../core/devices/rotary-presets';
import { Button, Dialog, DialogActions } from '../kit';
import { errorStyle } from './rotary-setup-dialog.styles';
import { startRotaryEdit } from './rotary-setup-edit';
import { RotarySetupFields } from './RotarySetupFields';
import { RotaryTestRotationPanel } from './RotaryTestRotationPanel';
import { useRotaryTestRotation } from './use-rotary-test-rotation';
import { RotaryWrapPreview } from './RotaryWrapPreview';
import type { RotaryArtworkExtent } from './rotary-wrap-preview';

export function RotarySetupDialog(props: {
  readonly setup: RotarySetup | undefined;
  readonly onCancel: () => void;
  readonly onApply: (setup: RotarySetup) => void;
  readonly onGenerateCalibration: (setup: RotarySetup) => void;
  /** Published rotaries for this machine (ADR-503). */
  readonly presets?: ReadonlyArray<RotaryPreset>;
  readonly artwork?: RotaryArtworkExtent | null;
  readonly outputDescription?: string;
}): JSX.Element {
  const [edit, setEdit] = useState(() => startRotaryEdit(props.setup ?? DEFAULT_ROTARY_SETUP));
  const test = useRotaryTestRotation();
  const { setup } = edit;
  const valid = rotaryMeasurementsValid(setup);
  return (
    <Dialog title="Rotary Setup" size="md" onClose={props.onCancel}>
      <RotarySetupFields
        edit={edit}
        onEdit={setEdit}
        {...(props.presets === undefined ? {} : { presets: props.presets })}
      />
      <RotaryWrapPreview
        setup={setup}
        {...(props.artwork === undefined ? {} : { artwork: props.artwork })}
        {...(props.outputDescription === undefined
          ? {}
          : { outputDescription: props.outputDescription })}
      />
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
