// Step 2 of the Device Setup wizard: pick the machine from the catalog. Unlike
// the Machine Setup dialog's CatalogCard (which replaces the live profile), a
// pick here only updates the wizard draft via apply-preset; nothing is
// committed until Finish.

import {
  GRBL_MACHINE_PROFILE_CATALOG,
  profileConfidenceLabel,
  profileSupportsCapability,
  suggestMachineProfiles,
  type ControllerKind,
  type DeviceProfile,
  type MachineProfileCatalogEntry,
  type MachineProfileSuggestion,
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
  const suggestions = suggestMachineProfiles({
    detectedControllerKind: state.detectedControllerKind,
    detectedSettings: state.detected,
    controllerSettings: null,
  });
  const suggestionByProfileId = new Map(
    suggestions.map((suggestion) => [suggestion.profileId, suggestion]),
  );
  const entries = hasSuggestionFacts(state.detectedControllerKind, state.detected)
    ? suggestions.map((suggestion) => suggestion.entry)
    : GRBL_MACHINE_PROFILE_CATALOG;
  return (
    <div style={catalogGridStyle}>
      {entries.map((entry) => (
        <PresetCard
          key={entry.profile.profileId ?? entry.profile.name}
          entry={entry}
          suggestion={suggestionByProfileId.get(entry.profile.profileId)}
          active={state.draft.profileId === entry.profile.profileId}
          onUse={() => dispatch({ kind: 'apply-preset', profile: entry.profile })}
        />
      ))}
    </div>
  );
}

function PresetCard(props: {
  readonly entry: MachineProfileCatalogEntry;
  readonly suggestion: MachineProfileSuggestion | undefined;
  readonly active: boolean;
  readonly onUse: () => void;
}): JSX.Element {
  const profile = props.entry.profile;
  return (
    <article style={cardStyle}>
      <div style={cardHeaderStyle}>
        <strong>{profile.name}</strong>
        <span style={badgeStyle}>{profileConfidenceLabel(props.entry.confidence)}</span>
      </div>
      <p style={mutedStyle}>
        {profile.bedWidth} x {profile.bedHeight} mm
        {profile.laserSubProfile?.opticalPowerW !== undefined
          ? `, ${profile.laserSubProfile.opticalPowerW}W`
          : ''}
      </p>
      <p style={mutedStyle}>Air-assist hardware: {airHardwareLabel(profile)}</p>
      <p style={mutedStyle}>Software air output: {airOutputLabel(profile.airAssistCommand)}</p>
      {props.suggestion !== undefined && props.suggestion.rank !== 'manual-only' ? (
        <p style={mutedStyle}>Profile match: {suggestionRankLabel(props.suggestion.rank)}</p>
      ) : null}
      <ul style={notesStyle}>
        {props.suggestion?.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
        {props.suggestion?.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
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

function hasSuggestionFacts(
  detectedControllerKind: ControllerKind | null,
  detectedSettings: Partial<DeviceProfile>,
): boolean {
  return detectedControllerKind !== null || Object.keys(detectedSettings).length > 0;
}

function airHardwareLabel(profile: DeviceProfile): string {
  return profileSupportsCapability(profile, 'air-assist') ? 'Supported' : 'Not listed';
}

function airOutputLabel(command: DeviceProfile['airAssistCommand']): string {
  return command === 'none' ? 'Disabled' : `Enabled (${command})`;
}

function suggestionRankLabel(rank: MachineProfileSuggestion['rank']): string {
  switch (rank) {
    case 'suggested':
      return 'Suggested';
    case 'possible':
      return 'Possible';
    case 'manual-only':
      return 'Manual only';
  }
}
