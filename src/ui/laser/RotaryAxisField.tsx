// Rotary Setup's axis choice (ADR-695), LightBurn's "Rotary Axis": Y when the
// rotary takes the Y motor's place, A or Z for a dedicated rotary port. Only
// the axes this controller can take are offered; a saved axis it cannot take
// stays shown, with why, so it is never silently changed.

import type { RotaryAxis, RotarySetup } from '../../core/devices/rotary';
import { rotaryAxisOf } from '../../core/devices/rotary-axis';
import { editRotaryAxis, type RotaryEdit } from './rotary-setup-edit';
import { hintStyle, segmentStyle } from './rotary-setup-dialog.styles';
import type { RotaryEditUpdate } from './RotaryObjectFields';
import { FieldRow, SegmentButton } from './RotarySetupRows';

const AXIS_HINTS: Readonly<Record<RotaryAxis, string>> = {
  Y: 'Y: the rotary is plugged in where the Y motor was, or into a Y port with a switch. The head does not move in Y.',
  A: 'A: the rotary has its own connector that the controller drives as an A axis, counted in degrees. The head stays at its Y.',
  Z: 'Z: the rotary has its own connector that the controller drives as Z. The head stays at its Y.',
};

export function RotaryAxisField(props: {
  readonly setup: RotarySetup;
  readonly axes: ReadonlyArray<RotaryAxis>;
  readonly onEdit: RotaryEditUpdate;
}): JSX.Element {
  const current = rotaryAxisOf(props.setup);
  const shown = props.axes.includes(current) ? props.axes : [...props.axes, current];
  const setAxis = (axis: RotaryAxis): void =>
    props.onEdit((edit: RotaryEdit) => editRotaryAxis(edit, axis));
  return (
    <>
      <FieldRow label="Rotary axis">
        <div role="group" aria-label="Rotary axis" style={segmentStyle}>
          {shown.map((axis) => (
            <SegmentButton key={axis} active={current === axis} onClick={() => setAxis(axis)}>
              {axis}
            </SegmentButton>
          ))}
        </div>
      </FieldRow>
      <p style={hintStyle}>
        {AXIS_HINTS[current]}
        {props.axes.includes(current)
          ? ''
          : ` This controller cannot take ${current}, so jobs are refused until you choose another axis.`}
      </p>
    </>
  );
}
