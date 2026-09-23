// The artwork inspector is the primary editor. The operation list is a
// secondary management surface; it must never push the active settings away.
import { useState } from 'react';
import { machineKindOf, type Layer } from '../../core/scene';
import { CollapsedRail } from '../common';
import { Icon, IconButton } from '../kit';
import { MachineModeToggle } from '../machine/MachineModeToggle';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { ArtworkPanelTabs } from './ArtworkPanelTabs';
import { ArtworkRunOrderPanel } from './ArtworkRunOrderPanel';
import { LayerRow } from './LayerRow';
import { MaterialLibraryPanel } from './MaterialLibraryPanel';
import { SelectedObjectProperties } from './SelectedObjectProperties';
import './cuts-layers-panel.css';
import './artwork-inspector.css';

export function CutsLayersPanel(): JSX.Element {
  const panelVisible = useUiStore((s) => s.railPanelVisibility.layers);
  const togglePanel = useUiStore((s) => s.toggleRailPanel);
  const requestedView = useUiStore((s) => s.cutsLayersView);
  const setView = useUiStore((s) => s.setCutsLayersView);
  const layers = useStore((s) => s.project.scene.layers);
  const machineKind = useStore((s) => machineKindOf(s.project.machine));
  const activeView = requestedView;
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
    <aside
      aria-label="Artwork / Operations panel"
      className="lf-rail lf-pane-form lf-artwork-panel"
    >
      <header className="lf-artwork-panel-heading">
        <h2>Artwork</h2>
        <MachineModeToggle />
        <IconButton
          icon="chevron-right"
          size="sm"
          label="Collapse Artwork / Operations panel"
          onClick={() => togglePanel('layers')}
        />
      </header>
      <ArtworkPanelTabs
        active={activeView}
        showMaterials={true}
        materialsLabel={machineKind === 'cnc' ? 'Recipes' : 'Materials'}
        onSelect={setView}
      />
      <div
        key={activeView}
        id={`cuts-layers-${activeView}-panel`}
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`cuts-layers-${activeView}-tab`}
        className="lf-artwork-view-content"
      >
        {activeView === 'materials' ? (
          <MaterialLibraryPanel />
        ) : activeView === 'run-order' ? (
          <ArtworkRunOrderPanel />
        ) : (
          <LayersView layers={layers} />
        )}
      </div>
    </aside>
  );
}

function LayersView({ layers }: { readonly layers: ReadonlyArray<Layer> }): JSX.Element {
  return (
    <>
      {layers.length === 0 ? <EmptyArtwork /> : null}
      <SelectedObjectProperties />
      {layers.length > 0 ? <OperationList layers={layers} /> : null}
    </>
  );
}

function EmptyArtwork(): JSX.Element {
  return (
    <section className="lf-artwork-empty" aria-label="Start with artwork">
      <div className="lf-artwork-empty__illustration" aria-hidden="true">
        <Icon name="square" size={32} />
        <Icon name="arrow-right" size={20} />
        <Icon name="sliders" size={32} />
      </div>
      <h3>Your artwork starts here</h3>
      <p>Import or draw artwork to create its first operation.</p>
      <p className="lf-artwork-hint">Then choose how to cut, engrave or carve it.</p>
    </section>
  );
}

function OperationList({ layers }: { readonly layers: ReadonlyArray<Layer> }): JSX.Element {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const entries = layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.name.toLocaleLowerCase().includes(query));
  return (
    <details className="lf-artwork-disclosure lf-operation-list">
      <summary title="Show all operations to choose a drawing colour and manage visibility and order">
        <Icon name="layers" size={18} />
        <span>
          <strong>All operations</strong>
          <small>Drawing colour, visibility and order</small>
        </span>
        <span className="lf-artwork-count">{layers.length}</span>
        <Icon name="chevron-down" size={16} />
      </summary>
      <div className="lf-artwork-disclosure__body">
        <p className="lf-artwork-hint">
          Select a drawing colour below. Use Run order to arrange the artwork in your job.
        </p>
        {layers.length > 4 || search !== '' ? (
          <input
            type="search"
            aria-label="Find an operation"
            title="Filter operations by name"
            placeholder="Find an operation…"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        ) : null}
        {entries.map(({ layer, index }) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            canMoveUp={index > 0}
            canMoveDown={index < layers.length - 1}
          />
        ))}
        {entries.length === 0 ? (
          <p className="lf-artwork-hint">No matching operations. Try another name.</p>
        ) : null}
      </div>
    </details>
  );
}
