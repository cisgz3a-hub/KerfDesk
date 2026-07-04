// CncMachineCatalogRow — load a built-in CNC machine preset (bed size + spindle
// ceiling) so an operator picks their router instead of hand-entering specs,
// mirroring the laser device catalog. Presets are PROVISIONAL clean-room specs;
// the row shows the per-machine "confirm before cutting" note. CNC-only; mounted
// by CncSetupPanel next to the user-saved Machine profiles.

import { useState } from 'react';
import { CNC_MACHINE_CATALOG } from '../../core/cnc';
import { useStore } from '../state';

export function CncMachineCatalogRow(): JSX.Element {
  const applyCncMachinePreset = useStore((s) => s.applyCncMachinePreset);
  const [selectedId, setSelectedId] = useState('');
  const preset = CNC_MACHINE_CATALOG.find((candidate) => candidate.id === selectedId) ?? null;
  return (
    <details style={detailsStyle}>
      <summary style={summaryStyle} title="Load a known hobby router's bed size and spindle max.">
        Machine catalog
      </summary>
      <div style={rowStyle}>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Built-in machine"
          title="Pick your CNC machine to seed its bed size and spindle max."
          style={selectStyle}
        >
          <option value="">Choose machine…</option>
          {CNC_MACHINE_CATALOG.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} — {candidate.bedWidthMm}×{candidate.bedHeightMm} mm
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={preset === null}
          onClick={() => preset !== null && applyCncMachinePreset(preset)}
          aria-label="Load machine"
          title="Set the bed size and spindle max from this machine (undoable)."
        >
          Load
        </button>
      </div>
      {preset !== null ? (
        <p style={noteStyle}>
          Sets bed {preset.bedWidthMm}×{preset.bedHeightMm} mm, spindle max {preset.spindleMaxRpm}{' '}
          RPM. {preset.note}
        </p>
      ) : null}
    </details>
  );
}

const detailsStyle: React.CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 6,
  marginTop: 6,
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  marginTop: 6,
};
const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, padding: '2px 4px' };
const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '4px 0 0 0',
};
