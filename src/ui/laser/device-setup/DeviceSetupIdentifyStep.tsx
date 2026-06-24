// Step 2 of the Device Setup wizard: pick the machine from the catalog. Unlike
// the Machine Setup dialog's CatalogCard (which replaces the live profile), a
// pick here only updates the wizard draft via apply-preset; nothing is
// committed until Finish.

import {
  GRBL_MACHINE_PROFILE_CATALOG,
  type MachineProfileCatalogEntry,
} from '../../../core/devices';
import { Button } from '../../kit';
import {
  badgeStyle,
  cardHeaderStyle,
  cardStyle,
  catalogGridStyle,
  mutedStyle,
  notesStyle,
} from '../MachineSetupStyles';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupIdentifyStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  return (
    <div style={catalogGridStyle}>
      {GRBL_MACHINE_PROFILE_CATALOG.map((entry) => (
        <PresetCard
          key={entry.profile.profileId ?? entry.profile.name}
          entry={entry}
          active={state.draft.profileId === entry.profile.profileId}
          onUse={() => dispatch({ kind: 'apply-preset', profile: entry.profile })}
        />
      ))}
    </div>
  );
}

function PresetCard(props: {
  readonly entry: MachineProfileCatalogEntry;
  readonly active: boolean;
  readonly onUse: () => void;
}): JSX.Element {
  const profile = props.entry.profile;
  return (
    <article style={cardStyle}>
      <div style={cardHeaderStyle}>
        <strong>{profile.name}</strong>
        <span style={badgeStyle}>{profile.profileSource ?? 'built-in'}</span>
      </div>
      <p style={mutedStyle}>
        {profile.bedWidth} x {profile.bedHeight} mm
        {profile.laserSubProfile?.opticalPowerW !== undefined
          ? `, ${profile.laserSubProfile.opticalPowerW}W`
          : ''}
      </p>
      <ul style={notesStyle}>
        {props.entry.reviewNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <Button
        variant={props.active ? 'default' : 'primary'}
        disabled={props.active}
        onClick={props.onUse}
        title={
          props.active ? 'This machine is selected.' : `Start from ${profile.name}'s defaults.`
        }
      >
        {props.active ? 'Selected' : `Use ${profile.name}`}
      </Button>
    </article>
  );
}
