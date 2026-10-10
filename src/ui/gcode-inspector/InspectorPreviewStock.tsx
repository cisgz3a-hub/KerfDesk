// The carved stock's switches on the canvas's G-code 3D view (ADR-579). The
// full Inspector keeps them in its readouts (ADR-487); the canvas view has
// none, so they sit in a compact panel over the view instead, and a program
// that carves a relief starts with its carved stock shown.

import { InspectorStockControl } from './InspectorStockControl';
import type { CarvedStock } from './use-carved-stock';

export function InspectorPreviewStock(props: { readonly stock: CarvedStock }): JSX.Element | null {
  if (!props.stock.available) return null;
  return (
    <details style={panelStyle} open aria-label="Carved stock">
      <summary style={titleStyle} title="Show or hide the carved stock's switches">
        Stock
      </summary>
      <InspectorStockControl stock={props.stock} />
    </details>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  right: 10,
  bottom: 54,
  zIndex: 2,
  width: 240,
  maxWidth: 'calc(100% - 20px)',
  boxSizing: 'border-box',
  padding: '6px 8px',
  borderRadius: 'var(--lf-radius-lg)',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
  fontSize: 'var(--lf-text-xs)',
};

const titleStyle: React.CSSProperties = { fontWeight: 600, cursor: 'pointer', marginBottom: 4 };
