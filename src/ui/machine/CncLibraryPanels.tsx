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
import { CncBitCatalogPanel } from './CncBitCatalogPanel';
import {
  addFormStyle,
  deleteButtonStyle,
  detailsStyle,
  kindSelectStyle,
  listItemStyle,
  listStyle,
  nameInputStyle,
  summaryStyle,
  toolGroupHeadingStyle,
  toolGroupListStyle,
  toolGroupStyle,
  toolNameStyle,
} from './CncLibraryPanels.styles';
import { groupCncTools } from './CncToolOptions';

export function CncToolManager(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const deleteCustomCncTool = useStore((state) => state.deleteCustomCncTool);
  const pushToast = useToastStore((state) => state.pushToast);
  const customToolIds = useStore(
    (state) => new Set(state.cncLibrary.customTools.map((tool) => tool.id)),
  );
  const groups = groupCncTools(props.machine.tools);
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
        {groups.map((group) => (
          <li key={group.key} style={toolGroupStyle}>
            <h4 style={toolGroupHeadingStyle}>{group.label}</h4>
            <ul style={toolGroupListStyle} aria-label={group.label}>
              {group.tools.map((tool) => (
                <CncToolManagerRow
                  key={tool.id}
                  tool={tool}
                  custom={customToolIds.has(tool.id)}
                  onDelete={() => deleteTool(tool.id)}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <CncBitCatalogPanel />
      <AddCncBitForm />
    </details>
  );
}

function CncToolManagerRow(props: {
  readonly tool: CncMachineConfig['tools'][number];
  readonly custom: boolean;
  readonly onDelete: () => void;
}): JSX.Element {
  const label = `${cncToolGeometryLabel(props.tool)} — ${props.tool.name}`;
  return (
    <li style={listItemStyle}>
      <span style={toolNameStyle} title={label} aria-label={label}>
        {label}
      </span>
      {props.custom ? (
        <button
          type="button"
          onClick={props.onDelete}
          aria-label={`Delete bit ${props.tool.name}`}
          title="Remove this custom bit. Primary assignments fall back to Active; visible clearing, finishing, or roughing assignments must be changed first."
          style={deleteButtonStyle}
        >
          Delete
        </button>
      ) : null}
    </li>
  );
}

function secondaryToolDeleteWarning(reference: {
  readonly layerColor: string;
  readonly role: string;
}): string {
  return `Cannot delete this bit: ${reference.role} on layer ${reference.layerColor} still uses it. Change that layer's secondary bit setting first.`;
}

export function CncMachineProfilesRow(): JSX.Element {
  const profiles = useStore((state) => state.cncLibrary.machineProfiles);
  const applyCncMachineProfile = useStore((state) => state.applyCncMachineProfile);
  const deleteCncMachineProfile = useStore((state) => state.deleteCncMachineProfile);
  const pushToast = useToastStore((state) => state.pushToast);
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
          onChange={(event) => setSelectedId(event.target.value)}
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
  const saveCncMachineProfile = useStore((state) => state.saveCncMachineProfile);
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
