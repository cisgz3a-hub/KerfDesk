import type { DeviceSetupStepProps } from './device-setup-flow';

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
          <p>Match the installed toolhead. Changing this choice does not power it on.</p>
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
    <svg
      className="lf-setup-type-icon"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 39h34M10 35V10h28v25M10 15h28" />
      {kind === 'cnc' ? (
        <>
          <path d="M19 15v11h10V15M22 26v8l4-3v-5M22 31l4-3" />
          <path d="M15 36h18" />
        </>
      ) : (
        <>
          <path d="M19 15v8l5 4 5-4v-8M24 29v6M18 34l-3 2M30 34l3 2" />
          <circle cx="24" cy="37" r="1" />
        </>
      )}
      {kind === 'hybrid' ? <path d="M35 23h8m-3-3 3 3-3 3M43 31h-8m3-3-3 3 3 3" /> : null}
    </svg>
  );
}
