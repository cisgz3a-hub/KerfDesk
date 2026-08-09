// CNC library panel (Phase H.7, F-CNC11/13): the bit manager now mounted only
// inside CNC Startup Setup. App-level data lives in cnc-library-persistence.

import type { CncMachineConfig, CncTool } from '../../core/scene';
import { DEFAULT_ASSUMED_FLUTE_COUNT } from '../../core/cnc/machine-starters';
import {
  CNC_RETAINED_FEEDS_WARNING,
  hasRetainedFeedsAfterEffectiveToolChange,
} from '../common/cnc-bit-change-advisory';
import { cncToolGeometryLabel } from '../common/cnc-tool-geometry-label';
import { useStore } from '../state';
import { blockingCncSecondaryToolReferences } from '../state/cnc-tool-references';
import { useToastStore } from '../state/toast-store';
import { RailSection } from '../kit';
import { AddCncBitForm } from './AddCncBitForm';
import { CncBitCatalogPanel } from './CncBitCatalogPanel';
import {
  deleteButtonStyle,
  fluteInputStyle,
  listItemStyle,
  listStyle,
  toolGroupHeadingStyle,
  toolGroupListStyle,
  toolGroupStyle,
  toolNameStyle,
} from './CncLibraryPanels.styles';
import { groupCncTools } from './CncToolOptions';

export function CncToolManager(props: {
  readonly machine: CncMachineConfig;
  readonly customTools?: ReadonlyArray<CncTool>;
  readonly onAddTool?: (tool: Omit<CncTool, 'id'>) => void;
  readonly onDeleteTool?: (toolId: string) => void;
  readonly onChangeFluteCount?: (toolId: string, fluteCount: number) => void;
}): JSX.Element {
  const deleteCustomCncTool = useStore((state) => state.deleteCustomCncTool);
  const pushToast = useToastStore((state) => state.pushToast);
  const storedCustomTools = useStore((state) => state.cncLibrary.customTools);
  const customTools = props.customTools ?? storedCustomTools;
  const customToolIds = new Set(customTools.map((tool) => tool.id));
  const groups = groupCncTools(props.machine.tools);
  const deleteTool = (toolId: string): void => {
    if (props.onDeleteTool !== undefined) {
      props.onDeleteTool(toolId);
      return;
    }
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
    <RailSection
      label="Manage bits"
      badge={String(props.machine.tools.length)}
      hint="Add or remove custom bits (saved across projects)."
    >
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
                  draftControlled={props.onDeleteTool !== undefined}
                  onDelete={() => deleteTool(tool.id)}
                  {...(props.onChangeFluteCount === undefined
                    ? {}
                    : { onChangeFluteCount: props.onChangeFluteCount })}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <CncBitCatalogPanel
        customTools={customTools}
        {...(props.onAddTool === undefined ? {} : { onAdd: props.onAddTool })}
      />
      <AddCncBitForm {...(props.onAddTool === undefined ? {} : { onAdd: props.onAddTool })} />
    </RailSection>
  );
}

function CncToolManagerRow(props: {
  readonly tool: CncMachineConfig['tools'][number];
  readonly custom: boolean;
  readonly draftControlled: boolean;
  readonly onDelete: () => void;
  readonly onChangeFluteCount?: (toolId: string, fluteCount: number) => void;
}): JSX.Element {
  const label = `${cncToolGeometryLabel(props.tool)} — ${props.tool.name}`;
  return (
    <li style={listItemStyle}>
      <span style={toolNameStyle} title={label} aria-label={label}>
        {label}
      </span>
      {props.onChangeFluteCount === undefined ? null : (
        <input
          type="number"
          min={1}
          max={MAX_TOOL_FLUTES}
          step={1}
          value={props.tool.fluteCount ?? DEFAULT_ASSUMED_FLUTE_COUNT}
          onChange={(event) => {
            const fluteCount = Number(event.target.value);
            if (!isValidFluteCount(fluteCount)) return;
            props.onChangeFluteCount?.(props.tool.id, fluteCount);
          }}
          aria-label={`Flute count for ${props.tool.name}`}
          title="Set this cutter's actual number of cutting flutes. This Startup Setup change is saved with the job."
          style={fluteInputStyle}
        />
      )}
      {props.custom ? (
        <button
          type="button"
          onClick={props.onDelete}
          aria-label={`Delete bit ${props.tool.name}`}
          title={
            props.draftControlled
              ? 'Remove this custom bit from the saved library and stage its Tool Plan assignments to use their defaults. The project changes on final Save.'
              : 'Remove this custom bit. Primary assignments fall back to Active; visible clearing, finishing, or roughing assignments must be changed first.'
          }
          style={deleteButtonStyle}
        >
          Delete
        </button>
      ) : null}
    </li>
  );
}

const MAX_TOOL_FLUTES = 16;

function isValidFluteCount(fluteCount: number): boolean {
  return Number.isInteger(fluteCount) && fluteCount >= 1 && fluteCount <= MAX_TOOL_FLUTES;
}

function secondaryToolDeleteWarning(reference: {
  readonly layerColor: string;
  readonly role: string;
}): string {
  return `Cannot delete this bit: ${reference.role} on layer ${reference.layerColor} still uses it. Change that assignment in Startup Setup > Tool Plan first.`;
}
