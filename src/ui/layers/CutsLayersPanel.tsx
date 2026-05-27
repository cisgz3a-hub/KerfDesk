// CutsLayersPanel — WORKFLOW.md F-A7 implementation.
//
// One row per Layer (one unique stroke color). Per-row controls live in
// LayerRow.tsx so this file stays focused on the panel layout / empty state.
// Phase A initial cut commits input changes on every keystroke; the F-A7
// 300 ms debounce is a follow-on commit.

import { useStore } from '../state';
import { LayerRow } from './LayerRow';

export function CutsLayersPanel(): JSX.Element {
  const layers = useStore((s) => s.project.scene.layers);
  if (layers.length === 0) {
    return (
      <aside aria-label="Cuts / Layers panel" style={panelStyle}>
        <h2 style={headingStyle}>Cuts / Layers</h2>
        <p style={hintStyle}>Import a design to populate layers.</p>
      </aside>
    );
  }
  return (
    <aside aria-label="Cuts / Layers panel" style={panelStyle}>
      <h2 style={headingStyle}>Cuts / Layers</h2>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}> </th>
            <th style={thStyle}>Mode</th>
            <th style={thStyle}>Power</th>
            <th style={thStyle}>Speed</th>
            <th style={thStyle}>Passes</th>
            <th style={thStyle}>Vis</th>
            <th style={thStyle}>Out</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((layer) => (
            <LayerRow key={layer.id} layer={layer} />
          ))}
        </tbody>
      </table>
    </aside>
  );
}

const panelStyle: React.CSSProperties = {
  // Explicit width + flexShrink: 0 — see the matching note in LaserWindow.
  // Width sized for the 7-column table (swatch + Mode + Power + Speed +
  // Passes + Vis + Out ≈ 480-500 px with current input/checkbox sizes).
  // 360 was too narrow and clipped the last two columns off-screen.
  // overflowX: 'auto' is the safety net for any future column.
  background: '#f5f5f5',
  borderLeft: '1px solid #ddd',
  padding: '8px 12px',
  width: 500,
  flexShrink: 0,
  overflowY: 'auto',
  overflowX: 'auto',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
};
const headingStyle: React.CSSProperties = { fontSize: 14, margin: '0 0 8px 0' };
const hintStyle: React.CSSProperties = { color: '#666', fontStyle: 'italic' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontWeight: 500,
  fontSize: 12,
  padding: '4px 4px',
  borderBottom: '1px solid #ddd',
};
