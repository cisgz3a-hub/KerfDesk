import { profileSupportsCapability, type DeviceProfile } from '../../core/devices';
import type { MachineKind } from '../../core/scene';

const FOCUS_STEPS_MM = [0.1, 0.5, 1, 2, 5] as const;

export function FocusJogControls(props: {
  readonly device: DeviceProfile;
  readonly machineKind: MachineKind;
  readonly disabled: boolean;
  readonly focusStep: number;
  readonly setFocusStep: (step: number) => void;
  readonly onJog: (direction: 1 | -1) => void;
  readonly onZeroZ: () => void;
}): JSX.Element {
  const supportsZAxis = profileSupportsCapability(props.device, 'z-axis');
  const isCncMachine = props.machineKind === 'cnc';
  if (!supportsZAxis && !isCncMachine) {
    return <p style={hintStyle}>Manual focus: adjust the laser head by hand.</p>;
  }
  const ready = focusJogReady(props.device, props.machineKind);
  const disabled = props.disabled || !ready;
  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <strong>{isCncMachine ? 'Z axis' : 'Focus / Z'}</strong>
        <select
          value={props.focusStep}
          onChange={(event) => props.setFocusStep(Number(event.target.value))}
          disabled={props.disabled}
          aria-label="Focus Z step size"
          title="Distance moved by each Z focus jog click."
        >
          {FOCUS_STEPS_MM.map((option) => (
            <option key={option} value={option}>
              {option} mm
            </option>
          ))}
        </select>
      </div>
      <div style={controlRowStyle}>
        <FocusButton
          glyph="Z+"
          label={`Jog Z+ ${props.focusStep} mm`}
          disabled={disabled}
          onClick={() => props.onJog(1)}
        />
        <FocusButton
          glyph="Z-"
          label={`Jog Z- ${props.focusStep} mm`}
          disabled={disabled}
          onClick={() => props.onJog(-1)}
        />
        {isCncMachine ? (
          <button
            type="button"
            onClick={props.onZeroZ}
            disabled={disabled}
            aria-label="Zero work Z at current bit height"
            title="Touch the bit to the stock top, then click to declare that height Z0 (G92 Z0)."
          >
            Zero Z
          </button>
        ) : null}
        {!ready && (
          <span style={hintStyle}>Confirm Z travel in Machine Setup before using Z jog.</span>
        )}
      </div>
    </div>
  );
}

export function focusJogReady(device: DeviceProfile, machineKind: MachineKind): boolean {
  return (
    machineKind === 'cnc' ||
    (profileSupportsCapability(device, 'z-axis') &&
      device.zTravelConfirmed === true &&
      isPositive(device.zTravelMm))
  );
}

function FocusButton(props: {
  readonly glyph: 'Z+' | 'Z-';
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={buttonStyle}
      aria-label={props.label}
      title={props.label}
    >
      {props.glyph}
    </button>
  );
}

function isPositive(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

const panelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-end', gap: 8 };
const controlRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const hintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.3,
};
const buttonStyle: React.CSSProperties = { width: 36, height: 36, fontSize: 16, cursor: 'pointer' };
