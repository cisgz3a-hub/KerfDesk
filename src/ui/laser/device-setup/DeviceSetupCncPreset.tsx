// Draft-only CNC machine presets. This belongs on step 1 because a preset
// supplies both the work area reviewed on step 3 and the spindle ceiling
// reviewed on step 4.

import { useState } from 'react';
import { CNC_MACHINE_CATALOG } from '../../../core/cnc';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupCncPreset({
  state,
  dispatch,
}: DeviceSetupStepProps): JSX.Element | null {
  const [selectedId, setSelectedId] = useState('');
  const preset = CNC_MACHINE_CATALOG.find((item) => item.id === selectedId) ?? null;
  if (state.draftMachine.kind !== 'cnc') return null;

  const apply = (): void => {
    if (preset === null || state.draftMachine.kind !== 'cnc') return;
    dispatch({
      kind: 'edit',
      patch: { bedWidth: preset.bedWidthMm, bedHeight: preset.bedHeightMm },
    });
    dispatch({
      kind: 'edit-machine',
      machine: {
        ...state.draftMachine,
        params: { ...state.draftMachine.params, spindleMaxRpm: preset.spindleMaxRpm },
      },
    });
  };

  return (
    <details open style={detailsStyle}>
      <summary
        style={summaryStyle}
        title="Show or hide built-in CNC presets for work area and spindle limits."
      >
        Optional: start from a CNC machine preset
      </summary>
      <div style={rowStyle}>
        <select
          aria-label="Built-in CNC machine"
          title="Choose a built-in CNC preset to seed the work area and spindle maximum."
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          <option value="">Choose machine…</option>
          {CNC_MACHINE_CATALOG.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} — {item.bedWidthMm}×{item.bedHeightMm} mm
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={preset === null}
          onClick={apply}
          title={
            preset === null
              ? 'Choose a CNC machine preset first.'
              : 'Copy this preset into the unsaved Machine Setup draft.'
          }
        >
          Load into draft
        </button>
      </div>
      {preset === null ? null : (
        <p style={noteStyle}>
          Sets work area and {preset.spindleMaxRpm} RPM spindle maximum. {preset.note}
        </p>
      )}
    </details>
  );
}

const detailsStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12, fontWeight: 600 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginTop: 7,
  flexWrap: 'wrap',
};
const noteStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
