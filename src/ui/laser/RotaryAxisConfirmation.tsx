// The one-time check a dedicated rotary axis needs before its first burn
// (ADR-693). KerfDesk can read whether a controller has an A axis, but not
// which connector the rotary is plugged into, or whether the firmware sends
// that axis there. So after a Test rotation finishes on A or Z, the operator
// says whether the rotary turned; until then Job Review warns.

import type { ControllerKind } from '../../core/devices/device-profile';
import type { DedicatedRotaryAxis, RotarySetup } from '../../core/devices/rotary';
import {
  dedicatedRotaryAxisOf,
  rotaryAxisNeedsConfirmation,
  rotaryAxisSupported,
} from '../../core/devices/rotary-axis';
import { Button } from '../kit';
import { buttonRowStyle, hintStyle } from './rotary-setup-dialog.styles';
import type { RotaryTestView } from './use-rotary-test-rotation';

/** Why the Test rotation cannot turn this axis on this controller, or null. */
export function rotaryAxisTestBlockReason(
  setup: RotarySetup,
  controllerKind: ControllerKind | undefined,
): string | null {
  const axis = dedicatedRotaryAxisOf(setup);
  if (axis === null) return null;
  const device = controllerKind === undefined ? {} : { controllerKind };
  if (rotaryAxisSupported(device, axis)) return null;
  return `This controller has no ${axis} axis KerfDesk can turn. Choose Y and use the Y motor port.`;
}

export function AxisConfirmation(props: {
  readonly setup: RotarySetup;
  readonly view: RotaryTestView;
  readonly onConfirm?: (axis: DedicatedRotaryAxis) => void;
}): JSX.Element | null {
  const axis = dedicatedRotaryAxisOf(props.setup);
  if (axis === null) return null;
  if (!rotaryAxisNeedsConfirmation(props.setup)) {
    return (
      <p style={hintStyle}>Confirmed: a Test rotation turned the rotary on the {axis} axis.</p>
    );
  }
  const turned =
    props.view.kind === 'finished' &&
    props.view.outcome.kind === 'done' &&
    props.view.plan.axis === axis;
  if (!turned || props.onConfirm === undefined) {
    return (
      <p style={hintStyle}>
        Before the first burn on the {axis} axis, run a Test rotation and confirm it turned the
        rotary. If the head or another motor moved instead, the rotary is on a different axis.
      </p>
    );
  }
  const confirm = props.onConfirm;
  return (
    <div style={buttonRowStyle}>
      <Button variant="primary" onClick={() => confirm(axis)}>
        The rotary turned: use the {axis} axis
      </Button>
    </div>
  );
}
