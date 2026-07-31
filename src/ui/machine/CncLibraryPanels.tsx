// CNC library panels (Phase H.7, F-CNC11/13): the bit manager (add/delete
// custom bits) and the named machine-profile row, both mounted inside the
// Material & Bit card. App-level data — see cnc-library-persistence.

import { useState } from 'react';
import type { CncMachineConfig } from '../../core/scene';
import {
  CNC_RETAINED_FEEDS_WARNING,
  hasRetainedFeedsAfterEffectiveToolChange,
} from '../common/cnc-bit-change-advisory';
import { cncToolGeometryLabel } from '../common/cnc-tool-geometry-label';
import { useStore } from '../state';
import { blockingCncSecondaryToolReferences } from '../state/cnc-tool-references';
import { useToastStore } from '../state/toast-store';
import { AddCncBitForm } from './AddCncBitForm';

export function CncToolManager(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const deleteCustomCncTool = useStore((s) => s.deleteCustomCncTool);
  const pushToast = useToastStore((s) => s.pushToast);
  const customToolIds = useStore((s) => new Set(s.cncLibrary.customTools.map((t) => t.id)));
  const deleteTool = (toolId: string): void => {
    const before = useStore.getState().project;
    const blockingReference = blockingCncSecondaryToolReferences(before.scene, toolId)[0];
    if (blockingReference !== undefined) {
      pushToast(secondaryToolDeleteWarning(blockingReference), 'warning');
      return;
    }
    deleteCustomCncTool(toolId);
    if (hasRetainedFeedsAfterEffectiveToolChange(before, useStore.getState().project)) {
      pushToast(CNC_RETAINED_FEEDS_WARNING, 'warning');
    }
  };
  return (
    <details style={detailsStyle}>
      <summary style={summaryStyle} title="Add or remove custom bits (saved across projects).">
        Manage bits ({props.machine.tools.length})
      </summary>
      <ul style={listStyle} aria-label="Bit list">
        {props.machine.tools.map((tool) => {
          const label = `${cncToolGeometryLabel(tool)} — ${tool.name}`;
          return (
            <li key={tool.id} style={listItemStyle}>
              <span style={toolNameStyle} title={label} aria-label={label}>
                {label}
              </span>
              {customToolIds.has(tool.id) ? (
                <button
                  type="button"
                  onClick={() => deleteTool(tool.id)}
                  aria-label={`Delete bit ${tool.name}`}
                  title="Remove this custom bit. Primary assignments fall back to Active; visible clearing, finishing, or roughing assignments must be changed first."
                  style={deleteButtonStyle}
                >
                  Delete
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <AddCncBitForm />
    </details>
  );
}

function secondaryToolDeleteWarning(reference: {
  readonly layerColor: string;
  readonly role: string;
}): string {
  return `Cannot delete this bit: ${reference.role} on layer ${reference.layerColor} still uses it. Change that layer's secondary bit setting first.`;
}

export function CncMachineProfilesRow(): JSX.Element {
  const profiles = useStore((s) => s.cncLibrary.machineProfiles);
  const applyCncMachineProfile = useStore((s) => s.applyCncMachineProfile);
  const deleteCncMachineProfile = useStore((s) => s.deleteCncMachineProfile);
  const pushToast = useToastStore((s) => s.pushToast);
  const [selectedId, setSelectedId] = useState('');
  const applyProfile = (): void => {
    const before = useStore.getState().project;
    applyCncMachineProfile(selectedId);
    if (hasRetainedFeedsAfterEffectiveToolChange(before, useStore.getState().project)) {
      pushToast(CNC_RETAINED_FEEDS_WARNING, 'warning');
    }
  };
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
          onClick={applyProfile}
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
      <SaveMachineProfileControls />
    </details>
  );
}

function SaveMachineProfileControls(): JSX.Element {
  const saveCncMachineProfile = useStore((s) => s.saveCncMachineProfile);
  const [saveName, setSaveName] = useState('');
  const saveProfile = (): void => {
    if (saveName.trim() === '') return;
    saveCncMachineProfile(saveName.trim());
    setSaveName('');
  };
  return (
    <div style={addFormStyle}>
      <input
        type="text"
        value={saveName}
        onChange={(event) => setSaveName(event.target.value)}
        placeholder="Profile name"
        aria-label="New machine profile name"
        title="Name for snapshotting the current CNC setup as a profile."
        style={nameInputStyle}
      />
      <button
        type="button"
        onClick={saveProfile}
        aria-label="Save machine profile"
        title="Snapshot the current stock/bit/spindle setup under this name."
      >
        Save
      </button>
    </div>
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
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 6,
  fontSize: 12,
};
const toolNameStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  lineHeight: 1.3,
};
const deleteButtonStyle: React.CSSProperties = { flexShrink: 0 };
const addFormStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginTop: 6,
  flexWrap: 'wrap',
};
const nameInputStyle: React.CSSProperties = { flex: 1, minWidth: 90, padding: '2px 6px' };
const kindSelectStyle: React.CSSProperties = { fontSize: 12, padding: '2px 4px' };
