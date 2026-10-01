// The Settings window (LightBurn gap LBG-F18; Rayforge's one Preferences
// window): the app preferences that used to be spread across the canvas, the
// toolbar, the Window menu and Tools → Labs, in one place.
//
// Every control here is the existing control or reads and writes the existing
// store, so the canvas snap popover, Window → Appearance, the toolbar layout
// picker, File → Recent Projects and Tools → Labs stay in step with it. Nothing
// here is project data: changes apply at once and stay on this computer.
// Machine and material settings keep their own homes; this window links there.

import { useId } from 'react';
import { machineKindOf, type MachineKind } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { LabsFeatureList } from '../laser/LabsSettingsDialog';
import { useStore } from '../state/store';
import { SettingsCanvasSection } from './SettingsCanvasSection';
import { SettingsGeneralSection } from './SettingsGeneralSection';
import { SettingsMachineSection } from './SettingsMachineSection';
import { useSettingsDialogStore, type SettingsSectionId } from './settings-dialog-store';
import { settingsNoteStyle } from './settings-styles';
import { RemoteAccessSection } from '../remote-access/RemoteAccessSection';

type SectionSpec = {
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly title: string;
  // Labs holds laser-only workflows (ADR-101): hidden while the project is CNC.
  readonly laserOnly?: boolean;
  readonly desktopOnly?: boolean;
};

export const SETTINGS_SECTIONS: ReadonlyArray<SectionSpec> = [
  {
    id: 'general',
    label: 'General',
    title: 'Theme, workspace layout, recent projects and autosave',
  },
  {
    id: 'canvas',
    label: 'Canvas',
    title: 'Snapping, grid spacing, start markers and arrow-key nudge distances',
  },
  {
    id: 'machine',
    label: 'Machine & materials',
    title: 'Links to Machine Setup and to your materials or recipes',
  },
  {
    id: 'labs',
    label: 'Labs',
    title: 'Optional laser workflows that are still being hardware-validated',
    laserOnly: true,
  },
  {
    id: 'remote',
    label: 'Phone & MCP',
    title: 'Approved remote viewing and editing connections',
    desktopOnly: true,
  },
];

export function visibleSettingsSections(machineKind: MachineKind): ReadonlyArray<SectionSpec> {
  return SETTINGS_SECTIONS.filter(
    (entry) =>
      (entry.laserOnly !== true || machineKind === 'laser') &&
      (entry.desktopOnly !== true ||
        (typeof location !== 'undefined' && location.protocol === 'app:')),
  );
}

export function SettingsDialog(props: { readonly onClose: () => void }): JSX.Element {
  const requested = useSettingsDialogStore((state) => state.section);
  const setSection = useSettingsDialogStore((state) => state.setSection);
  const machineKind = useStore((state) => machineKindOf(state.project.machine));
  const sections = visibleSettingsSections(machineKind);
  const active = sections.some((entry) => entry.id === requested) ? requested : 'general';
  const baseId = useId();
  return (
    <Dialog title="Settings" size="lg" onClose={props.onClose}>
      <div style={layoutStyle}>
        <SectionTabs baseId={baseId} sections={sections} active={active} onSelect={setSection} />
        <div
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-${active}`}
          style={panelStyle}
        >
          <SectionBody id={active} machineKind={machineKind} onClose={props.onClose} />
        </div>
      </div>
      <p style={settingsNoteStyle}>
        Changes apply at once and are kept on this computer. None of them is saved in a project.
      </p>
      <DialogActions>
        <Button variant="primary" onClick={props.onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function SectionTabs(props: {
  readonly baseId: string;
  readonly sections: ReadonlyArray<SectionSpec>;
  readonly active: SettingsSectionId;
  readonly onSelect: (id: SettingsSectionId) => void;
}): JSX.Element {
  const move = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = props.sections.findIndex((entry) => entry.id === props.active);
    const next = props.sections[(index + step + props.sections.length) % props.sections.length];
    if (next === undefined) return;
    props.onSelect(next.id);
    document.getElementById(`${props.baseId}-${next.id}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label="Settings sections"
      style={navStyle}
      onKeyDown={move}
    >
      {props.sections.map((entry) => {
        const selected = entry.id === props.active;
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`${props.baseId}-${entry.id}`}
            aria-selected={selected}
            aria-controls={`${props.baseId}-panel`}
            tabIndex={selected ? 0 : -1}
            className="lf-btn lf-btn--ghost"
            title={entry.title}
            style={selected ? activeTabStyle : tabStyle}
            onClick={() => props.onSelect(entry.id)}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

function SectionBody(props: {
  readonly id: SettingsSectionId;
  readonly machineKind: MachineKind;
  readonly onClose: () => void;
}): JSX.Element {
  switch (props.id) {
    case 'general':
      return <SettingsGeneralSection />;
    case 'canvas':
      return <SettingsCanvasSection />;
    case 'machine':
      return <SettingsMachineSection machineKind={props.machineKind} onClose={props.onClose} />;
    case 'labs':
      return <LabsFeatureList />;
    case 'remote':
      return <RemoteAccessSection />;
  }
}

const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 160px) 1fr',
  gap: 'var(--lf-space-4)',
  minHeight: 320,
};
const navStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  borderRight: '1px solid var(--lf-border)',
  paddingRight: 'var(--lf-space-3)',
};
const tabStyle: React.CSSProperties = { justifyContent: 'flex-start', textAlign: 'left' };
const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: 'var(--lf-accent-wash)',
  fontWeight: 600,
};
const panelStyle: React.CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 'var(--lf-space-4)',
  maxHeight: 'min(60vh, 520px)',
  overflowY: 'auto',
  paddingRight: 4,
};
