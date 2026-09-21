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
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupProfilePicker({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const suggestions = suggestMachineProfiles({
    detectedControllerKind: state.detectedControllerKind ?? null,
    detectedProfilePatch: state.detected,
    controllerSettings: state.controllerRead ? state.detected : null,
    settingsRows: [],
  });
  const matches = filterMachineProfileSuggestions(suggestions, query);
  const active = matches.find((suggestion) => profilePresetIsActive(state.draft, suggestion));
  const preview =
    active === undefined
      ? matches.slice(0, 2)
      : [active, ...matches.filter((item) => item !== active).slice(0, 1)];
  const visible = showAll || query.trim() !== '' ? matches : preview;
  return (
    <section aria-label="Reviewed machine profiles" className="lf-setup-catalog">
      <div className="lf-setup-catalog-heading">
        <div>
          <h4>Start with a machine profile</h4>
          <p>A starting point you can adjust in the next step.</p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search machines…"
          aria-label="Search machine profiles"
          title="Search by machine name, controller or work area."
        />
      </div>
      <div className="lf-setup-profile-grid">
        {visible.map((suggestion) => (
          <PresetCard
            key={suggestion.profileId}
            suggestion={suggestion}
            isActive={profilePresetIsActive(state.draft, suggestion)}
            onUse={() => dispatch({ kind: 'apply-preset', profile: suggestion.profile })}
          />
        ))}
      </div>
      {query.trim() === '' && matches.length > 2 ? (
        <Button variant="ghost" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          {showAll ? 'Show fewer profiles' : `Browse all ${matches.length} profiles`}
        </Button>
      ) : null}
      {visible.length === 0 ? (
        <p className="lf-setup-empty">
          No profile matches “{query}”. Try another search, or enter your settings below.
        </p>
      ) : null}
      <p className="lf-setup-catalog-hint">
        Machine not listed? Keep your current settings and check the controller below.
      </p>
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
  return (
    <article className="lf-setup-profile" data-selected={props.isActive}>
      <div className="lf-setup-profile-main">
        <div>
          <strong>{profile.name}</strong>
          <p>
            {profile.bedWidth} × {profile.bedHeight} mm
            {profile.laserSubProfile?.opticalPowerW !== undefined
              ? `, ${profile.laserSubProfile.opticalPowerW} W`
              : ''}
          </p>
        </div>
        <Button
          variant={props.isActive ? 'default' : 'primary'}
          disabled={props.isActive}
          onClick={props.onUse}
          aria-label={props.isActive ? `Selected ${profile.name}` : `Use ${profile.name}`}
          title={
            props.isActive ? 'This machine is selected.' : `Start from ${profile.name}'s defaults.`
          }
        >
          {props.isActive ? 'Selected' : 'Use profile'}
        </Button>
      </div>
      <div className="lf-setup-profile-badges">
        <span>{suggestionConfidenceLabel(suggestion.confidence)}</span>
        <span>{profileConfidenceLabel(profile)}</span>
      </div>
      {suggestion.warnings.length > 0 ? (
        <p className="lf-setup-profile-warning">{suggestion.warnings[0]}</p>
      ) : null}
      <details className="lf-setup-profile-notes">
        <summary title={`Read profile notes for ${profile.name}`}>Profile details</summary>
        {suggestion.confidence === 'manual-only' ? null : (
          <ul>
            {suggestion.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        <ul>
          {suggestion.entry.reviewNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function suggestionConfidenceLabel(confidence: MachineProfileSuggestion['confidence']): string {
  if (confidence === 'suggested') return 'Suggested match';
  if (confidence === 'possible') return 'Possible match';
  return 'Manual choice';
}
