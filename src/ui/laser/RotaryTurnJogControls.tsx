// Turn a rotary on a dedicated A or Z axis from the jog pad (ADR-695). With
// the rotary on A or Z the Y arrows move the head, so the part gets its own
// turn buttons, as LightBurn's Move window has rotational arrows that jog A
// "degrees of movement" per click
// (https://docs.lightburnsoftware.com/2.1/Reference/MoveWindow/). Each press
// is an ordinary jog through the store, with its readiness gate and cancel.

import { useState } from 'react';
import type { DedicatedRotaryAxis } from '../../core/devices';
import { rotaryAxisUnitLabel } from '../../core/devices/rotary-axis';
import { rotaryOutputAxis } from '../../core/job';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { clampJogFeed } from './jog-control-policy';
import { controllerActionFailureHandler } from './report-controller-action-failure';

const STEPS: Readonly<Record<DedicatedRotaryAxis, ReadonlyArray<number>>> = {
  A: [5, 15, 45, 90],
  Z: [1, 5, 10, 20],
};
const TURN_FEED = 1500;

export function RotaryTurnJogControls(props: { readonly disabled: boolean }): JSX.Element | null {
  const device = useStore((s) => s.project.device);
  const machine = useStore((s) => s.project.machine);
  const axis = rotaryOutputAxis(device, machine);
  if (axis === null) return null;
  return <TurnButtons axis={axis} disabled={props.disabled} maxFeed={device.maxFeed} />;
}

function TurnButtons(props: {
  readonly axis: DedicatedRotaryAxis;
  readonly disabled: boolean;
  readonly maxFeed: number;
}): JSX.Element {
  const steps = STEPS[props.axis];
  const [step, setStep] = useState<number>(steps[1] ?? 1);
  const jog = useLaserStore((s) => s.jog);
  const unit = rotaryAxisUnitLabel(props.axis);
  const shown = unit === '°' ? '°' : ' mm';
  const turn = (direction: 1 | -1): void => {
    const distance = direction * step;
    const feed = clampJogFeed(TURN_FEED, props.maxFeed);
    const params = props.axis === 'A' ? { da: distance, feed } : { dz: distance, feed };
    void jog(params).catch(controllerActionFailureHandler('Rotary turn'));
  };
  return (
    <div style={rowStyle}>
      <strong>Rotary ({props.axis})</strong>
      <button
        type="button"
        className="lf-btn"
        disabled={props.disabled}
        onClick={() => turn(-1)}
        aria-label={`Turn the rotary ${props.axis}- ${step}${shown}`}
        title={`Turn the part back ${step}${shown} on the ${props.axis} axis.`}
      >
        ↺
      </button>
      <button
        type="button"
        className="lf-btn"
        disabled={props.disabled}
        onClick={() => turn(1)}
        aria-label={`Turn the rotary ${props.axis}+ ${step}${shown}`}
        title={`Turn the part on ${step}${shown} on the ${props.axis} axis.`}
      >
        ↻
      </button>
      <select
        className="lf-select"
        value={step}
        disabled={props.disabled}
        onChange={(event) => setStep(Number(event.target.value))}
        aria-label="Rotary turn step"
        title="How far each turn button turns the part."
      >
        {steps.map((option) => (
          <option key={option} value={option}>
            {option}
            {shown}
          </option>
        ))}
      </select>
    </div>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
