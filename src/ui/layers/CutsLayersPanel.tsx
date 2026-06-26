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

import { useStore } from '../state';
import { AddLayerControls } from './AddLayerControls';
import { LayerRow } from './LayerRow';
import { MaterialLibraryPanel } from './MaterialLibraryPanel';
import { SelectedImageAdjustments } from './SelectedImageAdjustments';
import { SelectedObjectProperties } from './SelectedObjectProperties';

export function CutsLayersPanel(): JSX.Element {
  const layers = useStore((s) => s.project.scene.layers);
  return (
    <aside aria-label="Cuts / Layers panel" className="lf-rail" style={panelStyle}>
      <h2 className="lf-heading" style={headingStyle}>
        Cuts / Layers
      </h2>
      <AddLayerControls />
      <SelectedObjectProperties />
      <MaterialLibraryPanel />
      {layers.length === 0 ? (
        <p style={hintStyle}>Import a design to populate layers.</p>
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
      )}
      <SelectedImageAdjustments />
    </aside>
  );
}

// Surface chrome (background, border, scrollbars, text color) comes from
// .lf-rail; this constant keeps only the rail's layout.
const panelStyle: React.CSSProperties = {
  padding: '10px 12px',
  // Card layout means we don't need 500 px of horizontal room any more.
  // 320 px holds a clean two-column field-row layout (label + control)
  // and leaves plenty of width for the Laser panel on 1280-class monitors.
  width: 320,
  flexShrink: 0,
};
const headingStyle: React.CSSProperties = { margin: '0 0 10px 0' };
const hintStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontStyle: 'italic' };
const listStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column' };
