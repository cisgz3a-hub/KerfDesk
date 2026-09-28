// Rotary Setup fields. A roller either leaves Y unscaled (the controller
// already moves the part's surface in millimetres) or scales Y from the
// driven roller's diameter and Motion per turn, as LightBurn's roller setup
// does (ADR-373). A chuck always scales from Motion per turn.

import { useState } from 'react';
import type { RotarySetup, RotaryType } from '../../core/devices/rotary';
import type { RotaryPreset } from '../../core/devices/rotary-presets';
import { hintStyle, segmentStyle } from './rotary-setup-dialog.styles';
import {
  displayRotaryMm,
  editRollerDiameter,
  editRollerScaling,
  editRotaryFields,
  editRotaryPreset,
  editRotaryType,
  type RotaryEdit,
} from './rotary-setup-edit';
import { RotaryObjectFields, type RotaryEditUpdate } from './RotaryObjectFields';
import { FieldRow, RotaryNumberField, SegmentButton, ToggleRow } from './RotarySetupRows';

export function RotarySetupFields(props: {
  readonly edit: RotaryEdit;
  readonly onEdit: RotaryEditUpdate;
  /** Published rotaries for this machine, if any (ADR-503). */
  readonly presets?: ReadonlyArray<RotaryPreset>;
}): JSX.Element {
  const { edit, onEdit } = props;
  const { setup } = edit;
  const setType = (type: RotaryType): void => onEdit((current) => editRotaryType(current, type));
  return (
    <>
      {props.presets === undefined || props.presets.length === 0 ? null : (
        <RotaryPresetField presets={props.presets} onEdit={onEdit} />
      )}
      <ToggleRow
        checked={setup.enabled}
        label="Enable rotary for this machine profile"
        onChange={(enabled) => onEdit((current) => editRotaryFields(current, { enabled }))}
      />
      <FieldRow label="Rotary type">
        <div role="group" aria-label="Rotary type" style={segmentStyle}>
          <SegmentButton active={setup.type === 'roller'} onClick={() => setType('roller')}>
            Roller
          </SegmentButton>
          <SegmentButton active={setup.type === 'chuck'} onClick={() => setType('chuck')}>
            Chuck
          </SegmentButton>
        </div>
      </FieldRow>
      <RotaryObjectFields edit={edit} onEdit={onEdit} />
      {setup.type === 'roller' ? <RollerScaleFields setup={setup} onEdit={onEdit} /> : null}
      <MotionPerTurnField setup={setup} onEdit={onEdit} />
      <ToggleRow
        checked={setup.reverseAxis === true}
        label="Reverse rotary direction"
        onChange={(reverseAxis) => onEdit((current) => editRotaryFields(current, { reverseAxis }))}
      />
    </>
  );
}

function RotaryPresetField(props: {
  readonly presets: ReadonlyArray<RotaryPreset>;
  readonly onEdit: RotaryEditUpdate;
}): JSX.Element {
  const [chosen, setChosen] = useState<RotaryPreset | null>(null);
  return (
    <>
      <FieldRow label="Rotary preset">
        <select
          className="lf-input"
          aria-label="Rotary preset"
          title="Fill in the type and motion per turn from a rotary whose maker publishes them. The work's diameter and the switches stay as they are."
          value={chosen?.id ?? ''}
          onChange={(event) => {
            const preset = props.presets.find((item) => item.id === event.currentTarget.value);
            if (preset === undefined) return;
            setChosen(preset);
            props.onEdit((current) => editRotaryPreset(current, preset));
          }}
        >
          <option value="" disabled>
            Fill in a published rotary…
          </option>
          {props.presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </FieldRow>
      {chosen === null ? null : <p style={hintStyle}>{chosen.source}</p>}
    </>
  );
}

function RollerScaleFields(props: {
  readonly setup: RotarySetup;
  readonly onEdit: RotaryEditUpdate;
}): JSX.Element {
  const diameter = props.setup.rollerDiameterMm;
  return (
    <>
      <ToggleRow
        checked={diameter !== undefined}
        label="Scale Y from the roller diameter"
        onChange={(scaled) => props.onEdit((current) => editRollerScaling(current, scaled))}
      />
      {diameter === undefined ? (
        <p style={hintStyle}>
          Off: the controller already moves the part&apos;s surface in millimetres, so Y is not
          scaled.
        </p>
      ) : (
        <RotaryNumberField
          label="Roller diameter"
          ariaLabel="Rotary roller diameter"
          title="Diameter of the motor-driven roller the part rests on."
          value={displayRotaryMm(diameter)}
          unit="mm"
          disabled={false}
          onCommit={(next) => props.onEdit((current) => editRollerDiameter(current, next))}
        />
      )}
    </>
  );
}

function MotionPerTurnField(props: {
  readonly setup: RotarySetup;
  readonly onEdit: RotaryEditUpdate;
}): JSX.Element {
  const { setup } = props;
  const used = setup.type === 'chuck' || setup.rollerDiameterMm !== undefined;
  return (
    <RotaryNumberField
      label="Motion per turn"
      ariaLabel="Rotary millimetres per rotation"
      title={motionPerTurnTitle(setup, used)}
      value={setup.mmPerRotation}
      unit="machine mm"
      disabled={!used}
      onCommit={(mmPerRotation) =>
        props.onEdit((current) => editRotaryFields(current, { mmPerRotation }))
      }
    />
  );
}

function motionPerTurnTitle(setup: RotarySetup, used: boolean): string {
  if (!used) return 'Not used until Y is scaled from the roller diameter.';
  return setup.type === 'chuck'
    ? 'Machine Y travel that turns the chuck one full revolution.'
    : 'Machine Y travel that turns the driven roller one full revolution.';
}
