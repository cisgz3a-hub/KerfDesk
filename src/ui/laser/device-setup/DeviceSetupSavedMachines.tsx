// My machines in Machine Setup (ADR-374). The operator's own saved machines
// come before the reviewed catalog: choosing one loads its complete profile
// into this draft, and Save applies it like Switch to, ending any Frame.

import { explicitMachineKindsForProfile } from '../../../core/devices/device-profile';
import {
  savedMachinesByName,
  type SavedMachine,
} from '../../../core/saved-machines/saved-machine-list';
import { savedMachineSummary } from '../../saved-machines/saved-machine-describe';
import { useSavedMachinesStore } from '../../state/saved-machines-store';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupSavedMachines({
  state,
  dispatch,
}: DeviceSetupStepProps): JSX.Element | null {
  const list = useSavedMachinesStore((store) => store.list);
  const machines = savedMachinesByName(list);
  if (machines.length === 0) return null;
  const use = (machine: SavedMachine): void => {
    dispatch({ kind: 'apply-preset', profile: machine.profile });
    // Mirror the preset rule: an undeclared profile keeps the draft's kinds.
    const explicit = explicitMachineKindsForProfile(machine.profile);
    const kinds = explicit.length === 0 ? state.machineKinds : explicit;
    if (kinds.includes(machine.machineKind)) {
      dispatch({ kind: 'select-machine-kind', machineKind: machine.machineKind });
    }
  };
  return (
    <section aria-label="My machines" className="lf-setup-catalog">
      <div className="lf-setup-catalog-heading">
        <div>
          <h4>My machines</h4>
          <p>Your saved machines. Choosing one loads every one of its settings into this setup.</p>
        </div>
      </div>
      <div className="lf-setup-profile-grid">
        {machines.map((machine) => (
          <SavedMachineCard
            key={machine.id}
            machine={machine}
            isDefault={list.defaultMachineId === machine.id}
            isActive={state.draft.savedMachineId === machine.id}
            onUse={() => use(machine)}
          />
        ))}
      </div>
    </section>
  );
}

function SavedMachineCard(props: {
  readonly machine: SavedMachine;
  readonly isDefault: boolean;
  readonly isActive: boolean;
  readonly onUse: () => void;
}): JSX.Element {
  const name = props.machine.name;
  return (
    <article className="lf-setup-profile" data-selected={props.isActive}>
      <label className="lf-setup-profile-choice">
        <input
          type="radio"
          name="setup-saved-machine"
          checked={props.isActive}
          onChange={props.onUse}
          aria-label={`Use saved machine ${name}`}
          title={
            props.isActive
              ? 'This setup is based on this saved machine.'
              : `Load every setting of your saved machine ${name}.`
          }
        />
        <span className="lf-setup-profile-main">
          <strong>{name}</strong>
          <span className="lf-setup-profile-size">{savedMachineSummary(props.machine)}</span>
        </span>
        <span className="lf-setup-profile-badges">
          <span>My machine</span>
          {props.isDefault ? <span>Default</span> : null}
        </span>
      </label>
    </article>
  );
}
