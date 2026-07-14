// Apply and save CNC feeds/speeds presets without squeezing both operations
// into one overflowing row. Presets remain advanced helpers: they patch the
// editable layer values and never change cut type, total depth, or tabs.

import { useState } from 'react';
import type { CncLayerSettings, Layer } from '../../core/scene';
import { useStore } from '../state';
import { feedPresetPatch } from '../state/cnc-library-actions';
import { Row, selectStyle } from './CncLayerPrimitives';

export function CncFeedPresetRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const presets = useStore((s) => s.cncLibrary.feedPresets);
  const saveCncFeedPreset = useStore((s) => s.saveCncFeedPreset);
  const [saveName, setSaveName] = useState('');
  const trimmedName = saveName.trim();
  return (
    <>
      <Row label="Apply preset">
        <select
          value=""
          disabled={presets.length === 0}
          onChange={(event) => {
            const preset = presets.find((candidate) => candidate.id === event.target.value);
            if (preset !== undefined) props.onCommit(feedPresetPatch(preset));
          }}
          aria-label={`Apply feeds preset for ${props.layer.color}`}
          title="Apply a saved feeds/speeds preset to this layer."
          style={selectStyle}
        >
          <option value="">{presets.length === 0 ? 'No saved presets' : 'Choose preset…'}</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Save preset">
        <input
          type="text"
          value={saveName}
          onChange={(event) => setSaveName(event.target.value)}
          placeholder="Preset name"
          aria-label={`New feeds preset name for ${props.layer.color}`}
          title="Name for saving this layer's feeds/speeds as a preset."
          style={presetNameStyle}
        />
        <button
          type="button"
          disabled={trimmedName.length === 0}
          onClick={() => {
            if (trimmedName.length === 0) return;
            saveCncFeedPreset(trimmedName, props.settings);
            setSaveName('');
          }}
          aria-label={`Save feeds preset for ${props.layer.color}`}
          title="Save this layer's feed, plunge, spindle, depth/pass, and stepover under a name."
          style={saveButtonStyle}
        >
          Save
        </button>
      </Row>
    </>
  );
}

const presetNameStyle: React.CSSProperties = {
  flex: '1 1 120px',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '2px 6px',
  fontSize: 12,
};
const saveButtonStyle: React.CSSProperties = { flexShrink: 0 };
