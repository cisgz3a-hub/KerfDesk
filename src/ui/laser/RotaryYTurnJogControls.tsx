// RotaryYTurnJogControls — turn the part on a Y-port rotary by degrees (rolling
// audit v12 X8-P3-4). The jog pad's Y step is machine millimetres, which on a
// rotary turn the part by a scale only Rotary Setup knows: with the Creality
// chuck (40 mm per turn) a 10 mm step is 90°. LightBurn's Move window turns
// an A-axis rotary in degrees; this row does the same for the Y-port rotary
// KerfDesk drives, so putting the seam at the back is one click, not trial
// jogs. Each step is the jog pad's own Y jog (same feed, same travel checks),
// sized `degrees / 360` of one turn of the part. "+" turns the part the way a
// job's increasing Y does, so Reverse rotary axis flips the machine sign.

import { useState } from 'react';
import { rotaryCircumferenceMm } from '../../core/devices';
import { rotaryWrapLimitMm } from '../../core/job';
import { rotaryOutputAxis } from '../../core/job/rotary-job';
import { useStore } from '../state';
import type { JogVector } from './jog-control-policy';
import { formatRotaryMm } from './rotary-summary';

const TURN_STEPS_DEG = [1, 5, 15, 30, 45, 90, 180] as const;
const DEFAULT_TURN_STEP_DEG = 15;

/** Machine Y mm that turn the part `degrees`; `turnMm` is one full turn. */
export function rotaryYTurnJogMm(degrees: number, turnMm: number, reverse: boolean): number {
  const mm = (degrees / 360) * turnMm;
  return reverse ? -mm : mm;
}

export function RotaryYTurnJogControls(props: {
  readonly disabled: boolean;
  readonly feed: number;
  readonly onJog: (vector: JogVector) => void;
}): JSX.Element | null {
  const device = useStore((s) => s.project.device);
  const machine = useStore((s) => s.project.machine);
  const [stepDeg, setStepDeg] = useState<number>(DEFAULT_TURN_STEP_DEG);
  const turnMm = rotaryWrapLimitMm(device, machine);
  const rotary = device.rotary;
  // A rotary on A or Z has its own turn buttons (ADR-695); Y would move the head.
  if (rotaryOutputAxis(device, machine) !== null) return null;
  if (turnMm === null || !(turnMm > 0) || rotary === undefined) return null;
  const reverse = rotary.reverseAxis === true;
  const surfaceMm = (stepDeg / 360) * rotaryCircumferenceMm(rotary);
  const turn = (direction: 1 | -1): void =>
    props.onJog({ dy: direction * rotaryYTurnJogMm(stepDeg, turnMm, reverse), feed: props.feed });
  return (
    <div role="group" aria-label="Turn the part" style={rowStyle}>
      <span>Turn the part</span>
      <button
        type="button"
        className="lf-btn"
        aria-label={`Turn the part −${stepDeg}°`}
        title={`Turn the part back ${stepDeg}° (one Y jog of that share of a turn).`}
        disabled={props.disabled}
        onClick={() => turn(-1)}
      >
        −{stepDeg}°
      </button>
      <select
        className="lf-select"
        aria-label="Rotary Y turn step"
        value={stepDeg}
        disabled={props.disabled}
        onChange={(event) => setStepDeg(Number(event.target.value))}
        title="How far each Turn click turns the part, in degrees of a full turn."
      >
        {TURN_STEPS_DEG.map((option) => (
          <option key={option} value={option}>
            {option}°
          </option>
        ))}
      </select>
      <button
        type="button"
        className="lf-btn"
        aria-label={`Turn the part +${stepDeg}°`}
        title={`Turn the part on ${stepDeg}°, the way a job's increasing Y turns it.`}
        disabled={props.disabled}
        onClick={() => turn(1)}
      >
        +{stepDeg}°
      </button>
      <span title="Distance the part's surface moves for each Turn click.">
        = {formatRotaryMm(surfaceMm)} mm of surface
      </span>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
};
