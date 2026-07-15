// CutsLayersPanel — WORKFLOW.md F-A7 implementation.
//
// One vertical card per Layer (one unique stroke color). Per-card
// controls live in LayerRow.tsx; this file owns the panel chrome
// (heading, empty state, scroll behaviour).
//
// Cards stack vertically — the panel uses its full height rather
// than cramming settings horizontally into a 7-column table. Each
// card carries its own colour swatch + Mode + Show/Output toggles
// in a header strip, then power / speed / passes / mode-specific
// fields as field rows below.

import { machineKindOf } from '../../core/scene';
import { CollapsedRail, RailPanelHeading } from '../common';
import { CncSetupPanel } from '../machine/CncSetupPanel';
import { MachineModeToggle } from '../machine/MachineModeToggle';
import { useStore } from '../state';
import { type CutsLayersView, useUiStore } from '../state/ui-store';
import { CncAdvancedToggle } from './CncAdvancedToggle';
import { LayerRow } from './LayerRow';
import { DogboneRow } from './DogboneRow';
import { MaterialLibraryPanel } from './MaterialLibraryPanel';
import { OffsetPathsRow } from './OffsetPathsRow';
import { SelectedObjectProperties } from './SelectedObjectProperties';
import { SelectedReliefProperties } from './SelectedReliefProperties';

export function CutsLayersPanel(): JSX.Element {
  const panelVisible = useUiStore((s) => s.railPanelVisibility.layers);
  const togglePanel = useUiStore((s) => s.toggleRailPanel);
  const requestedView = useUiStore((s) => s.cutsLayersView);
  const setView = useUiStore((s) => s.setCutsLayersView);
  const layers = useStore((s) => s.project.scene.layers);
  const machineKind = useStore((s) => machineKindOf(s.project.machine));
  // The Material Library stores laser presets (power/speed); it hides in CNC
  // mode where those numbers have no meaning.
  const showMaterialLibrary = machineKind === 'laser';
  const activeView = showMaterialLibrary ? requestedView : 'layers';
  if (!panelVisible) {
    return (
      <CollapsedRail
        title="Artwork / Operations"
        ariaLabel="Artwork / Operations panel collapsed"
        onExpand={() => togglePanel('layers')}
      />
    );
  }
  return (
    <aside aria-label="Artwork / Operations panel" className="lf-rail" style={panelStyle}>
      <RailPanelHeading title="Artwork / Operations" onCollapse={() => togglePanel('layers')} />
      <MachineModeToggle />
      {showMaterialLibrary ? <ViewTabs active={activeView} onSelect={setView} /> : null}
      {showMaterialLibrary ? (
        <div
          id={`cuts-layers-${activeView}-panel`}
          role="tabpanel"
          aria-labelledby={`cuts-layers-${activeView}-tab`}
          style={viewContentStyle}
        >
          {activeView === 'materials' ? <MaterialLibraryPanel /> : <LayersView layers={layers} />}
        </div>
      ) : (
        <LayersView layers={layers} />
      )}
    </aside>
  );
}

function ViewTabs(props: {
  readonly active: CutsLayersView;
  readonly onSelect: (view: CutsLayersView) => void;
}): JSX.Element {
  return (
    <div role="tablist" aria-label="Cuts and materials" style={viewTabsStyle}>
      <ViewTab
        view="layers"
        label="Operations"
        selected={props.active === 'layers'}
        onSelect={props.onSelect}
      />
      <ViewTab
        view="materials"
        label="Materials"
        selected={props.active === 'materials'}
        onSelect={props.onSelect}
      />
    </div>
  );
}

function ViewTab(props: {
  readonly view: CutsLayersView;
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: (view: CutsLayersView) => void;
}): JSX.Element {
  return (
    <button
      id={`cuts-layers-${props.view}-tab`}
      type="button"
      role="tab"
      aria-controls={`cuts-layers-${props.view}-panel`}
      aria-selected={props.selected}
      title={`Show ${props.label.toLowerCase()}`}
      className={props.selected ? 'lf-btn lf-btn--primary' : 'lf-btn lf-btn--ghost'}
      style={viewTabStyle}
      onClick={() => props.onSelect(props.view)}
    >
      {props.label}
    </button>
  );
}

function LayersView(props: {
  readonly layers: ReturnType<typeof useStore.getState>['project']['scene']['layers'];
}): JSX.Element {
  return (
    <>
      <SelectedObjectProperties />
      <CncSetupPanel />
      <OffsetPathsRow />
      <DogboneRow />
      <SelectedReliefProperties />
      <CncAdvancedToggle />
      <LayerList layers={props.layers} />
    </>
  );
}

function LayerList(props: {
  readonly layers: ReturnType<typeof useStore.getState>['project']['scene']['layers'];
}): JSX.Element {
  const { layers } = props;
  return layers.length === 0 ? (
    <p style={hintStyle}>Import or draw artwork to create its first operation.</p>
  ) : (
    <div style={listStyle}>
      {layers.map((layer, index) => (
        <LayerRow
          key={layer.id}
          layer={layer}
          canMoveUp={index > 0}
          canMoveDown={index < layers.length - 1}
        />
      ))}
    </div>
  );
}

// Surface chrome (background, border, scrollbars, text color) comes from
// .lf-rail; this constant keeps only the rail's layout.
const panelStyle: React.CSSProperties = {
  padding: '10px 12px',
  // Card layout means we don't need 500 px of horizontal room any more.
  // 320 px holds a clean two-column field-row layout (label + control)
  // and leaves plenty of width for the Laser panel on 1280-class monitors.
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
};
// Layers remains the default working page; reusable preset management is a
// sibling page so an empty library cannot push the active job controls down.
const hintStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontStyle: 'italic' };
const listStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column' };
const viewTabsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 4,
  margin: '10px 0',
  paddingBottom: 10,
  borderBottom: '1px solid var(--lf-border)',
};
const viewTabStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 32,
};
const viewContentStyle: React.CSSProperties = { minHeight: 0 };
