// Machine type for a machine that isn't listed (ADR-637): a listed machine
// already says what it is, so the type is asked only in the "My machine isn't
// listed" form. A Laser + CNC machine also says which toolhead is fitted.

import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupMachineCapability({
  state,
  dispatch,
}: DeviceSetupStepProps): JSX.Element {
  const hybrid = state.machineKinds.length === 2;
  return (
    <div className="lf-setup-capabilities">
      <fieldset className="lf-setup-machine-types">
        <legend>Type</legend>
        <div className="lf-setup-type-grid">
          <MachineChoice
            label="Laser only"
            description="Cut and engrave with a laser."
            checked={!hybrid && state.machineKinds[0] === 'laser'}
            onChange={() => dispatch({ kind: 'set-machine-kinds', machineKinds: ['laser'] })}
          />
          <MachineChoice
            label="CNC only"
            description="Carve and mill with a spindle."
            checked={!hybrid && state.machineKinds[0] === 'cnc'}
            onChange={() => dispatch({ kind: 'set-machine-kinds', machineKinds: ['cnc'] })}
          />
          <MachineChoice
            label="Laser + CNC"
            description="One machine, swappable toolheads."
            checked={hybrid}
            onChange={() => dispatch({ kind: 'set-machine-kinds', machineKinds: ['laser', 'cnc'] })}
          />
        </div>
      </fieldset>
      {hybrid ? <DeviceSetupToolheadChoice state={state} dispatch={dispatch} /> : null}
    </div>
  );
}

export function DeviceSetupToolheadChoice({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  return (
    <fieldset className="lf-setup-active-mode">
      <legend>Which toolhead will you use?</legend>
      {(['laser', 'cnc'] as const).map((kind) => (
        <label key={kind}>
          <input
            type="radio"
            name="active-machine-kind"
            checked={state.machineKind === kind}
            onChange={() => dispatch({ kind: 'select-machine-kind', machineKind: kind })}
            title="Select the workspace mode after saving. This does not power the toolhead."
          />
          {kind === 'cnc' ? 'CNC' : 'Laser'}
        </label>
      ))}
      <p>
        Match the installed toolhead. Changing this choice does not power it on. After saving,
        switch heads with Laser / CNC in the machine toolbar.
      </p>
    </fieldset>
  );
}

function MachineChoice(props: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}): JSX.Element {
  return (
    <label className="lf-setup-type-card" data-selected={props.checked} title={props.description}>
      <input
        type="radio"
        name="machine-capability"
        aria-label={props.label}
        checked={props.checked}
        onChange={props.onChange}
        title={props.description}
      />
      <strong>{props.label}</strong>
    </label>
  );
}
