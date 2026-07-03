// DesignLibraryDialog — the bundled starter art library (ADR-105 G11).
// Entries insert through the SAME SVG import pipeline as Import SVG…, so
// they land as normal vector objects (line art — engrave/on-path ready;
// pocket closed shapes after Convert to Path edits). Previews render as
// data: images so no markup is injected.

import { useState } from 'react';
import { parseSvg } from '../../io/svg';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import {
  DESIGN_LIBRARY,
  LIBRARY_CATEGORIES,
  type LibraryCategory,
  type LibraryEntry,
} from './design-library';

export function DesignLibraryDialog(): JSX.Element | null {
  const open = useUiStore((s) => s.libraryDialogOpen);
  const setOpen = useUiStore((s) => s.setLibraryDialogOpen);
  const importSvgObject = useStore((s) => s.importSvgObject);
  const pushToast = useToastStore((s) => s.pushToast);
  const [category, setCategory] = useState<LibraryCategory>('Animals');
  if (!open) return null;

  const insert = (item: LibraryEntry): void => {
    const result = parseSvg({
      svgText: item.svgText,
      id: crypto.randomUUID(),
      source: `Library: ${item.name}`,
    });
    if (result.object === null) {
      pushToast(`Could not insert ${item.name}.`, 'error');
      return;
    }
    importSvgObject(result.object);
    pushToast(`${item.name} added to the canvas as line art.`, 'success');
    setOpen(false);
  };

  return (
    <div role="dialog" aria-label="Design library" style={backdropStyle}>
      <div style={panelStyle}>
        <div style={headerStyle}>
          <h3 style={titleStyle}>Design library</h3>
          <button type="button" onClick={() => setOpen(false)} title="Close the design library.">
            Close
          </button>
        </div>
        <div style={tabsStyle}>
          {LIBRARY_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={c === category}
              title={`Show the ${c} designs.`}
              style={c === category ? activeTabStyle : tabStyle}
            >
              {c}
            </button>
          ))}
        </div>
        <div style={gridStyle}>
          {DESIGN_LIBRARY.filter((item) => item.category === category).map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => insert(item)}
              title={`Insert "${item.name}" onto the canvas.`}
              style={cellStyle}
            >
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(item.svgText)}`}
                alt={item.name}
                width={40}
                height={40}
                style={iconStyle}
              />
              <span style={nameStyle}>{item.name}</span>
            </button>
          ))}
        </div>
        <p style={footStyle}>
          Bundled from lucide (ISC) — imports as engraveable line art. Need filled artwork? Import
          any SVG (CC0 sources like openclipart work great).
        </p>
      </div>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--lf-backdrop)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 40,
};
const panelStyle: React.CSSProperties = {
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 12,
  width: 560,
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'calc(100vh - 96px)',
  overflowY: 'auto',
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 8,
};
const titleStyle: React.CSSProperties = { fontSize: 14, margin: 0 };
const tabsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  marginBottom: 8,
};
const tabStyle: React.CSSProperties = { padding: '4px 8px' };
const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: 'var(--lf-accent)',
  color: 'var(--lf-bg)',
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
  gap: 8,
};
const cellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: 8,
};
const iconStyle: React.CSSProperties = { filter: 'invert(0.8)' };
const nameStyle: React.CSSProperties = { fontSize: 11 };
const footStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '10px 0 0 0',
};
