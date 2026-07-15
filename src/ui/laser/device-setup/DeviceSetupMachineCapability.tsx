import { mutedStyle } from '../MachineSetupStyles';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupMachineCapability({
  state,
  dispatch,
}: DeviceSetupStepProps): JSX.Element {
  const hybrid = state.machineKinds.length === 2;
  return (
    <div style={capabilityStackStyle}>
      <fieldset style={fieldsetStyle}>
        <legend>Machine capability</legend>
        <p style={mutedStyle}>
          This controls which workspace modes are available. Choose Laser + CNC only for a machine
          with interchangeable toolheads.
        </p>
        <MachineCapabilityRadio
          label="Laser only — beam power, air assist, raster, and focus settings"
          checked={state.machineKinds.length === 1 && state.machineKinds[0] === 'laser'}
          onChange={() => dispatch({ kind: 'set-machine-kinds', machineKinds: ['laser'] })}
        />
        <MachineCapabilityRadio
          label="CNC only — safe Z, spindle, coolant, and park settings"
          checked={state.machineKinds.length === 1 && state.machineKinds[0] === 'cnc'}
          onChange={() => dispatch({ kind: 'set-machine-kinds', machineKinds: ['cnc'] })}
        />
        <MachineCapabilityRadio
          label="Laser + CNC — interchangeable laser and spindle toolheads"
          checked={hybrid}
          onChange={() => dispatch({ kind: 'set-machine-kinds', machineKinds: ['laser', 'cnc'] })}
        />
      </fieldset>
      {hybrid ? (
        <fieldset style={fieldsetStyle}>
          <legend>Active mode after Save</legend>
          <MachineCapabilityRadio
            name="active-machine-kind"
            label="Laser"
            checked={state.machineKind === 'laser'}
            onChange={() => dispatch({ kind: 'select-machine-kind', machineKind: 'laser' })}
          />
          <MachineCapabilityRadio
            name="active-machine-kind"
            label="CNC"
            checked={state.machineKind === 'cnc'}
            onChange={() => dispatch({ kind: 'select-machine-kind', machineKind: 'cnc' })}
          />
          <p style={mutedStyle}>
            Switching mode never energizes a tool. Confirm the installed toolhead and its hardware
            interlocks before running a job.
          </p>
        </fieldset>
      ) : null}
    </div>
  );
}

function MachineCapabilityRadio(props: {
  readonly name?: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}): JSX.Element {
  return (
    <label style={choiceStyle}>
      <input
        type="radio"
        name={props.name ?? 'machine-capability'}
        checked={props.checked}
        onChange={props.onChange}
        title={`Configure Machine Setup for ${props.label}.`}
      />
      <span>{props.label}</span>
    </label>
  );
}

const capabilityStackStyle: React.CSSProperties = { display: 'grid', gap: 8 };
const fieldsetStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 10,
};
const choiceStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  fontSize: 12,
};
