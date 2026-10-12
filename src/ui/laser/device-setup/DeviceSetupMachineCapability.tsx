import type { DeviceSetupStepProps } from './device-setup-flow';
import { IconFrame } from '../../kit/icon-frame';

export function DeviceSetupMachineCapability({
  state,
  dispatch,
}: DeviceSetupStepProps): JSX.Element {
  const hybrid = state.machineKinds.length === 2;
  return (
    <div className="lf-setup-capabilities">
      <fieldset className="lf-setup-machine-types">
        <legend>What kind of machine do you have?</legend>
        <div className="lf-setup-type-grid">
          <MachineChoice
            kind="laser"
            label="Laser only"
            description="Cut and engrave with a laser."
            checked={!hybrid && state.machineKinds[0] === 'laser'}
            onChange={() => dispatch({ kind: 'set-machine-kinds', machineKinds: ['laser'] })}
          />
          <MachineChoice
            kind="cnc"
            label="CNC only"
            description="Carve and mill with a spindle."
            checked={!hybrid && state.machineKinds[0] === 'cnc'}
            onChange={() => dispatch({ kind: 'set-machine-kinds', machineKinds: ['cnc'] })}
          />
          <MachineChoice
            kind="hybrid"
            label="Laser + CNC"
            description="One machine, swappable toolheads."
            checked={hybrid}
            onChange={() => dispatch({ kind: 'set-machine-kinds', machineKinds: ['laser', 'cnc'] })}
          />
        </div>
      </fieldset>
      {hybrid ? (
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
      ) : null}
    </div>
  );
}

function MachineChoice(props: {
  readonly kind: 'laser' | 'cnc' | 'hybrid';
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}): JSX.Element {
  return (
    <label className="lf-setup-type-card" data-selected={props.checked}>
      <input
        type="radio"
        name="machine-capability"
        aria-label={props.label}
        checked={props.checked}
        onChange={props.onChange}
        title={props.description}
      />
      <MachineTypeIcon kind={props.kind} />
      <strong>{props.label}</strong>
      <span>{props.description}</span>
    </label>
  );
}

function MachineTypeIcon({ kind }: { readonly kind: 'laser' | 'cnc' | 'hybrid' }): JSX.Element {
  return (
    <IconFrame className="lf-setup-type-icon" size={44}>
      <path d="M3 20h18M5 18V5h14v13M5 8h14" />
      {kind === 'cnc' ? (
        <>
          <path d="M9 8v6h6V8" />
          <path className="lf-icon-accent" d="M11 14v4l2-1.5V14m-2 2.5 2-1.5M8 18h8" />
        </>
      ) : (
        <>
          <path d="M9 8v4l3 2 3-2V8" />
          <path className="lf-icon-accent" d="M12 14v4M9 17l-1 1M15 17l1 1" />
        </>
      )}
      {kind === 'hybrid' ? (
        <path className="lf-icon-accent" d="M17 11h5m-2-2 2 2-2 2M22 16h-5m2-2-2 2 2 2" />
      ) : null}
    </IconFrame>
  );
}
