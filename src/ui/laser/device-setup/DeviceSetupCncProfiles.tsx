import { useState } from 'react';
import type { CncMachineConfig } from '../../../core/scene';
import { useStore } from '../../state';
import { mergeCncMachineProfileForCurrentProject } from '../../state/cnc-machine-profile-merge';

export function DeviceSetupCncProfiles(props: {
  readonly machine: CncMachineConfig;
  readonly onApply: (machine: CncMachineConfig) => void;
}): JSX.Element {
  const profiles = useStore((state) => state.cncLibrary.machineProfiles);
  const saveFromDraft = useStore((state) => state.saveCncMachineProfileFromDraft);
  const deleteProfile = useStore((state) => state.deleteCncMachineProfile);
  const [selectedId, setSelectedId] = useState('');
  const [saveName, setSaveName] = useState('');
  const applySelected = (): void => {
    const profile = profiles.find((candidate) => candidate.id === selectedId);
    if (profile === undefined) return;
    props.onApply(mergeCncMachineProfileForCurrentProject(profile.machine, props.machine));
  };
  const deleteSelected = (): void => {
    if (selectedId === '') return;
    deleteProfile(selectedId);
    setSelectedId('');
  };
  const saveDraft = (): void => {
    const name = saveName.trim();
    if (name === '') return;
    saveFromDraft(name, props.machine);
    setSaveName('');
  };
  return (
    <div style={stackStyle}>
      <div style={rowStyle}>
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          aria-label="Saved setup profile"
          title="Load a saved CNC setup into this draft. The project changes only after final Save."
        >
          <option value="">Choose saved setup…</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={applySelected}
          aria-label="Apply saved setup profile"
          title="Copy the selected saved profile into this draft; final Save commits it to the project."
        >
          Apply to draft
        </button>
        <button
          type="button"
          onClick={deleteSelected}
          aria-label="Delete saved setup profile"
          title="Delete the selected app-level saved profile immediately."
        >
          Delete
        </button>
      </div>
      <div style={rowStyle}>
        <input
          type="text"
          value={saveName}
          onChange={(event) => setSaveName(event.target.value)}
          placeholder="Setup profile name"
          aria-label="New setup profile name"
          title="Name the app-level profile that will snapshot the current Startup Setup draft."
        />
        <button
          type="button"
          onClick={saveDraft}
          aria-label="Save current draft as setup profile"
          title="Save the current draft to the app-level profile library immediately."
        >
          Save current draft
        </button>
      </div>
      <ProfileLibraryHint />
    </div>
  );
}

function ProfileLibraryHint(): JSX.Element {
  return (
    <p style={hintStyle}>
      Applying stays in this draft until final Save. Library Save and Delete happen immediately.
    </p>
  );
}

const stackStyle: React.CSSProperties = { display: 'grid', gap: 6 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
};
const hintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.35,
};
