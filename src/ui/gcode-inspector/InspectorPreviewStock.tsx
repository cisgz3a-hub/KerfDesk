// The carved stock's switches on the canvas's G-code 3D view (ADR-580). The
// full Inspector keeps them in its readouts (ADR-487); the canvas view has
// none, so they sit in a compact panel over the view instead, and a program
// that carves a relief starts with its carved stock shown.

import { InspectorStockControl } from './InspectorStockControl';
import './inspector-viewer.css';
import type { CarvedStock } from './use-carved-stock';

export function InspectorPreviewStock(props: { readonly stock: CarvedStock }): JSX.Element | null {
  if (!props.stock.available) return null;
  return (
    <details className="gcode-viewer-stock-panel" open aria-label="Carved stock">
      <summary title="Show or hide the carved stock's switches">Stock</summary>
      <InspectorStockControl stock={props.stock} />
    </details>
  );
}
