// The carved stock's switches in the Inspector's readouts (ADR-487).

import type { CarvedStock } from './use-carved-stock';
import { UNKNOWN_TOOL } from './stock-carving';

export function InspectorStockControl(props: { readonly stock: CarvedStock }): JSX.Element {
  const { stock } = props;
  return (
    <div style={columnStyle}>
      <label style={toggleStyle}>
        <input
          type="checkbox"
          title="Show the block of material the program carves, carved as far as playback has got"
          checked={stock.shown}
          onChange={(event) => stock.onShownChange(event.currentTarget.checked)}
        />
        Show carved stock
      </label>
      <label style={toggleStyle}>
        <input
          type="checkbox"
          title="Draw the toolpath over the carved stock"
          checked={stock.toolpathShown}
          disabled={!stock.shown}
          onChange={(event) => stock.onToolpathShownChange(event.currentTarget.checked)}
        />
        Toolpath over the stock
      </label>
      {stock.shown && stock.unknownTool ? (
        <p style={noteStyle}>
          No bit size in the file for some moves: they carve with a {UNKNOWN_TOOL.diameterMm} mm end
          mill.
        </p>
      ) : null}
      {stock.failed ? <p style={noteStyle}>The stock could not be carved here.</p> : null}
    </div>
  );
}

const columnStyle: React.CSSProperties = { display: 'grid', gap: 2 };

const toggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const noteStyle: React.CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--lf-text-muted)',
  fontSize: 'var(--lf-text-xs)',
};
