// Step 2 of the Device Setup wizard: pick the machine from the catalog. Unlike
// the Machine Setup dialog's CatalogCard (which replaces the live profile), a
// pick here only updates the wizard draft via apply-preset; nothing is
// committed until Finish.

import {
  controllerProfilesAreCompatible,
  profileConfidenceLabel,
  suggestMachineProfiles,
  type MachineProfileSuggestion,
} from '../../../core/devices';
import { Button } from '../../kit';
import {
  badgeStyle,
  buttonRowStyle,
  cardHeaderStyle,
  cardStyle,
  catalogGridStyle,
  mutedStyle,
  notesStyle,
} from '../MachineSetupStyles';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupIdentifyStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const suggestions = suggestMachineProfiles({
    detectedControllerKind: state.detectedControllerKind ?? null,
    detectedProfilePatch: state.detected,
    controllerSettings: state.controllerRead ? state.detected : null,
    settingsRows: [],
  });
  return (
    <div style={catalogGridStyle}>
      {suggestions.map((suggestion) => (
        <PresetCard
          key={suggestion.profileId}
          suggestion={suggestion}
          active={state.draft.profileId === suggestion.profile.profileId}
          controllerMismatch={
            !controllerProfilesAreCompatible(
              suggestion.profile.controllerKind,
              state.detectedControllerKind ??
                (state.controllerRead ? (state.draft.controllerKind ?? null) : null),
            )
          }
          onUse={() => {
            dispatch({ kind: 'apply-preset', profile: suggestion.profile });
            dispatch({ kind: 'go', step: 'confirm' });
          }}
        />
      ))}
    </div>
  );
}

function PresetCard(props: {
  readonly suggestion: MachineProfileSuggestion;
  readonly active: boolean;
  readonly controllerMismatch: boolean;
  readonly onUse: () => void;
}): JSX.Element {
  const profile = props.suggestion.profile;
  return (
    <article style={cardStyle}>
      <div style={cardHeaderStyle}>
        <strong>{profile.name}</strong>
        <span style={buttonRowStyle}>
          <span style={badgeStyle}>{suggestionConfidenceLabel(props.suggestion.confidence)}</span>
          <span style={badgeStyle}>{profileConfidenceLabel(profile)}</span>
        </span>
      </div>
      <p style={mutedStyle}>
        {profile.bedWidth} x {profile.bedHeight} mm
        {profile.laserSubProfile?.opticalPowerW !== undefined
          ? `, ${profile.laserSubProfile.opticalPowerW}W`
          : ''}
      </p>
      <ul style={notesStyle}>
        {props.suggestion.entry.reviewNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
        {props.suggestion.reasons.slice(0, 2).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
        {props.suggestion.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
      <Button
        variant={props.active ? 'default' : 'primary'}
        disabled={props.active || props.controllerMismatch}
        onClick={props.onUse}
        title={
          props.active
            ? 'This machine is selected.'
            : props.controllerMismatch
              ? 'This profile uses a different controller family than the connected firmware.'
              : `Start from ${profile.name}'s defaults.`
        }
      >
        {props.active
          ? 'Selected'
          : props.controllerMismatch
            ? 'Firmware mismatch'
            : `Use ${profile.name}`}
      </Button>
    </article>
  );
}

function suggestionConfidenceLabel(confidence: MachineProfileSuggestion['confidence']): string {
  if (confidence === 'suggested') return 'Suggested match';
  if (confidence === 'possible') return 'Possible match';
  return 'Manual choice';
}
