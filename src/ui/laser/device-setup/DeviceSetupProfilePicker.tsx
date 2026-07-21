// Always-visible, searchable catalog of reviewed machine profiles — the
// first thing the operator sees in Machine Setup. One click fills the whole
// draft; the manual identity fields below it remain the fallback for
// machines that are not listed. (ADR-240)

import { useState } from 'react';
import {
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  profileConfidenceLabel,
  suggestMachineProfiles,
  type DeviceProfile,
  type MachineProfileSuggestion,
} from '../../../core/devices';
import { filterMachineProfileSuggestions } from '../../../core/devices/profile-suggestions';
import { fillRunwayPolicyForDevice } from '../../../core/job/fill-runway-policy';
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

export function DeviceSetupProfilePicker({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const [query, setQuery] = useState('');
  const suggestions = suggestMachineProfiles({
    detectedControllerKind: state.detectedControllerKind ?? null,
    detectedProfilePatch: state.detected,
    controllerSettings: state.controllerRead ? state.detected : null,
    settingsRows: [],
  });
  const visible = filterMachineProfileSuggestions(suggestions, query);
  return (
    <section aria-label="Reviewed machine profiles" style={pickerStyle}>
      <div style={pickerHeaderStyle}>
        <strong>Pick your machine</strong>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search machines…"
          aria-label="Search machine profiles"
          title="Filter the reviewed profiles by machine name, controller, or bed size."
          style={searchStyle}
        />
      </div>
      <p style={mutedStyle}>
        One click fills every setting with the profile&apos;s reviewed defaults. You still confirm
        work area, origin, homing, and power before saving — or skip this and configure the machine
        manually below.
      </p>
      <div style={catalogGridStyle}>
        {visible.map((suggestion) => (
          <PresetCard
            key={suggestion.profileId}
            suggestion={suggestion}
            isActive={profilePresetIsActive(state.draft, suggestion)}
            onUse={() => dispatch({ kind: 'apply-preset', profile: suggestion.profile })}
          />
        ))}
      </div>
      {visible.length === 0 ? (
        <p style={mutedStyle}>
          No profile matches “{query}”. Clear the search or configure the machine manually below.
        </p>
      ) : null}
    </section>
  );
}

function profilePresetIsActive(
  draft: DeviceProfile,
  suggestion: MachineProfileSuggestion,
): boolean {
  if (draft.profileId !== suggestion.profile.profileId) return false;
  if (suggestion.profile.profileId !== NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.profileId) return true;
  return fillRunwayPolicyForDevice(draft) !== undefined;
}

function PresetCard(props: {
  readonly suggestion: MachineProfileSuggestion;
  readonly isActive: boolean;
  readonly onUse: () => void;
}): JSX.Element {
  const { suggestion } = props;
  const profile = suggestion.profile;
  const buttonTitle = props.isActive
    ? 'This machine is selected.'
    : `Start from ${profile.name}'s defaults.`;
  return (
    <article style={cardStyle}>
      <div style={cardHeaderStyle}>
        <strong>{profile.name}</strong>
        <span style={buttonRowStyle}>
          <span style={badgeStyle}>{suggestionConfidenceLabel(suggestion.confidence)}</span>
          <span style={badgeStyle}>{profileConfidenceLabel(profile)}</span>
        </span>
      </div>
      <p style={mutedStyle}>
        {profile.bedWidth} × {profile.bedHeight} mm
        {profile.laserSubProfile?.opticalPowerW !== undefined
          ? `, ${profile.laserSubProfile.opticalPowerW} W`
          : ''}
      </p>
      {suggestion.confidence === 'manual-only' ? null : (
        <ul style={reasonsStyle}>
          {suggestion.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {suggestion.warnings.length > 0 ? <p style={warningStyle}>{suggestion.warnings[0]}</p> : null}
      <ul style={notesStyle}>
        {suggestion.entry.reviewNotes.slice(0, 2).map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <Button
        variant={props.isActive ? 'default' : 'primary'}
        disabled={props.isActive}
        onClick={props.onUse}
        title={buttonTitle}
      >
        {props.isActive ? 'Selected' : `Use ${profile.name}`}
      </Button>
    </article>
  );
}

function suggestionConfidenceLabel(confidence: MachineProfileSuggestion['confidence']): string {
  if (confidence === 'suggested') return 'Suggested match';
  if (confidence === 'possible') return 'Possible match';
  return 'Manual choice';
}

const pickerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 10,
};
const pickerHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
  fontSize: 13,
};
const searchStyle: React.CSSProperties = { flex: '1 1 180px', maxWidth: 260, fontSize: 12 };
const reasonsStyle: React.CSSProperties = {
  margin: '2px 0 4px',
  paddingLeft: 18,
  fontSize: 11,
  color: 'var(--lf-success-fg)',
};
const warningStyle: React.CSSProperties = {
  margin: '2px 0 4px',
  fontSize: 11,
  color: 'var(--lf-warning)',
};
