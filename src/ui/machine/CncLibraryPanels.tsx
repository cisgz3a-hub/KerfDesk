// CNC library panels (Phase H.7, F-CNC11/13): the bit manager (add/delete
// custom bits) and the named machine-profile row, both mounted inside the
// Material & Bit card. App-level data — see cnc-library-persistence.

import { useState } from 'react';
import type { CncMachineConfig, CncToolKind } from '../../core/scene';
import { useStore } from '../state';

const TOOL_KIND_OPTIONS: ReadonlyArray<{ readonly value: CncToolKind; readonly label: string }> = [
  { value: 'end-mill', label: 'End mill' },
  { value: 'ball-nose', label: 'Ball nose' },
  { value: 'v-bit', label: 'V-bit' },
  { value: 'engraving', label: 'Engraving' },
];

const MAX_TOOL_DIAMETER_MM = 50;
const MAX_TIP_ANGLE_DEG = 179;

export function CncToolManager(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const deleteCustomCncTool = useStore((s) => s.deleteCustomCncTool);
  const customToolIds = useStore((s) => new Set(s.cncLibrary.customTools.map((t) => t.id)));
  return (
    <details style={detailsStyle}>
      <summary style={summaryStyle} title="Add or remove custom bits (saved across projects).">
        Manage bits ({props.machine.tools.length})
      </summary>
      <ul style={listStyle} aria-label="Bit list">
        {props.machine.tools.map((tool) => (
          <li key={tool.id} style={listItemStyle}>
            <span style={toolNameStyle}>
              {tool.name} — {tool.diameterMm} mm
            </span>
            {customToolIds.has(tool.id) ? (
              <button
                type="button"
                onClick={() => deleteCustomCncTool(tool.id)}
                aria-label={`Delete bit ${tool.name}`}
                title="Remove this custom bit from the machine and the saved library. Layers using it fall back to the active bit."
              >
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <AddBitForm />
    </details>
  );
}

function AddBitForm(): JSX.Element {
  const addCustomCncTool = useStore((s) => s.addCustomCncTool);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CncToolKind>('end-mill');
  const [diameter, setDiameter] = useState('3.175');
  const [tipAngle, setTipAngle] = useState('60');
  const needsAngle = kind === 'v-bit' || kind === 'engraving';

  const onAdd = (): void => {
    const diameterMm = Number.parseFloat(diameter);
    const tipAngleDeg = Number.parseFloat(tipAngle);
    if (name.trim() === '' || !(diameterMm > 0) || diameterMm > MAX_TOOL_DIAMETER_MM) return;
    addCustomCncTool({
      name: name.trim(),
      kind,
      diameterMm,
      ...(needsAngle && tipAngleDeg > 0 && tipAngleDeg <= MAX_TIP_ANGLE_DEG ? { tipAngleDeg } : {}),
    });
    setName('');
  };

  return (
    <div style={addFormStyle}>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Bit name"
        aria-label="New bit name"
        title="Display name for the custom bit."
        style={nameInputStyle}
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as CncToolKind)}
        aria-label="New bit kind"
        title="Bit geometry: end mill, ball nose, v-bit, or engraving."
        style={kindSelectStyle}
      >
        {TOOL_KIND_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        value={diameter}
        onChange={(e) => setDiameter(e.target.value)}
        min={0.1}
        max={MAX_TOOL_DIAMETER_MM}
        step={0.1}
        aria-label="New bit diameter (mm)"
        title="Cutting diameter in millimeters."
        style={numberInputStyle}
      />
      {needsAngle ? (
        <input
          type="number"
          value={tipAngle}
          onChange={(e) => setTipAngle(e.target.value)}
          min={1}
          max={MAX_TIP_ANGLE_DEG}
          step={1}
          aria-label="New bit tip angle (deg)"
          title="Included tip angle for v/engraving bits."
          style={numberInputStyle}
        />
      ) : null}
      <button type="button" onClick={onAdd} aria-label="Add bit" title="Add the custom bit.">
        Add
      </button>
    </div>
  );
}

export function CncMachineProfilesRow(): JSX.Element {
  const profiles = useStore((s) => s.cncLibrary.machineProfiles);
  const saveCncMachineProfile = useStore((s) => s.saveCncMachineProfile);
  const applyCncMachineProfile = useStore((s) => s.applyCncMachineProfile);
  const deleteCncMachineProfile = useStore((s) => s.deleteCncMachineProfile);
  const [selectedId, setSelectedId] = useState('');
  const [saveName, setSaveName] = useState('');
  return (
    <details style={detailsStyle}>
      <summary
        style={summaryStyle}
        title="Save the current stock/bit/spindle setup under a name and re-apply it on any project."
      >
        Machine profiles ({profiles.length})
      </summary>
      <div style={addFormStyle}>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Saved machine profile"
          title="Pick a saved CNC machine profile."
          style={kindSelectStyle}
        >
          <option value="">Choose profile…</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={selectedId === ''}
          onClick={() => applyCncMachineProfile(selectedId)}
          aria-label="Apply machine profile"
          title="Replace the current CNC setup with the saved profile (undoable)."
        >
          Apply
        </button>
        <button
          type="button"
          disabled={selectedId === ''}
          onClick={() => {
            deleteCncMachineProfile(selectedId);
            setSelectedId('');
          }}
          aria-label="Delete machine profile"
          title="Remove the saved profile."
        >
          Delete
        </button>
      </div>
      <div style={addFormStyle}>
        <input
          type="text"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Profile name"
          aria-label="New machine profile name"
          title="Name for snapshotting the current CNC setup as a profile."
          style={nameInputStyle}
        />
        <button
          type="button"
          onClick={() => {
            if (saveName.trim() === '') return;
            saveCncMachineProfile(saveName.trim());
            setSaveName('');
          }}
          aria-label="Save machine profile"
          title="Snapshot the current stock/bit/spindle setup under this name."
        >
          Save
        </button>
      </div>
    </details>
  );
}

const detailsStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '4px 6px',
  marginTop: 4,
};
const summaryStyle: React.CSSProperties = {
  fontSize: 12,
  cursor: 'pointer',
  userSelect: 'none',
  color: 'var(--lf-text-muted)',
};
const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '6px 0',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 160,
  overflowY: 'auto',
};
const listItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  fontSize: 12,
};
const toolNameStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const addFormStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginTop: 6,
  flexWrap: 'wrap',
};
const nameInputStyle: React.CSSProperties = { flex: 1, minWidth: 90, padding: '2px 6px' };
const kindSelectStyle: React.CSSProperties = { fontSize: 12, padding: '2px 4px' };
const numberInputStyle: React.CSSProperties = { width: 64, padding: '2px 6px' };
