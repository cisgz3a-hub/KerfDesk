// The carved stock's switches in the Inspector's readouts (ADR-487).

// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import {
  STOCK_MATERIAL_LABEL,
  STOCK_MATERIALS,
  type StockMaterial,
} from '../viewer3d/scene-stock-materials';
import { InspectorStockSave } from './InspectorStockSave';
import type { StockComparison } from './stock-compare';
import type { CarvedStock, StockCompare } from './use-carved-stock';
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
      <label style={toggleStyle}>
        Material
        <select
          aria-label="Stock material"
          title="What the stock is made of, as drawn"
          value={stock.material}
          disabled={!stock.shown}
          onChange={(event) => stock.onMaterialChange(event.currentTarget.value as StockMaterial)}
          style={selectStyle}
        >
          {STOCK_MATERIALS.map((material) => (
            <option key={material} value={material}>
              {STOCK_MATERIAL_LABEL[material]}
            </option>
          ))}
        </select>
      </label>
      <label style={toggleStyle}>
        <input
          type="checkbox"
          title="Shade the carving: the key light's shadows fall into it, and its corners and deep narrow cuts darken"
          checked={stock.shaded}
          disabled={!stock.shown}
          onChange={(event) => stock.onShadedChange(event.currentTarget.checked)}
        />
        Shadows and occlusion
      </label>
      {stock.compare.available ? <CompareControl compare={stock.compare} /> : null}
      {stock.shown ? <InspectorStockSave stl={stock.stl} /> : null}
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

const TOLERANCES_MM = [0.05, 0.1, 0.25, 0.5] as const;

// The key to the 3D view's compare colours (scene-stock-compare.ts, linear
// there, sRGB here): scene data, not chrome, so no theme token stands for them.
/* eslint-disable no-restricted-syntax -- the 3D view's compare colours */
const LEFT_COLOUR = '#95c4f9';
const WITHIN_COLOUR = '#6fce86';
const DEEP_COLOUR = '#f99586';
/* eslint-enable no-restricted-syntax */

function CompareControl(props: { readonly compare: StockCompare }): JSX.Element {
  const { compare } = props;
  return (
    <>
      <label style={toggleStyle}>
        <input
          type="checkbox"
          title="Colour the carving against the relief design: green within the tolerance, blue where material is left, red where it cuts too deep"
          checked={compare.shown}
          onChange={(event) => compare.onShownChange(event.currentTarget.checked)}
        />
        Compare with the design
      </label>
      <label style={toggleStyle}>
        Tolerance
        <select
          aria-label="Compare tolerance"
          title="How far from the design still counts as on it"
          value={compare.toleranceMm}
          disabled={!compare.shown}
          onChange={(event) => compare.onToleranceChange(Number(event.currentTarget.value))}
          style={selectStyle}
        >
          {TOLERANCES_MM.map((tolerance) => (
            <option key={tolerance} value={tolerance}>
              ± {tolerance} mm
            </option>
          ))}
        </select>
      </label>
      {compare.shown && compare.result !== null ? (
        <CompareResult result={compare.result} toleranceMm={compare.toleranceMm} />
      ) : null}
    </>
  );
}

function CompareResult(props: {
  readonly result: StockComparison;
  readonly toleranceMm: number;
}): JSX.Element {
  const { result, toleranceMm } = props;
  const share = (cells: number): string =>
    `${result.cells === 0 ? 0 : Math.round((cells / result.cells) * 100)}%`;
  return (
    <ul aria-label="Carving against the design" style={resultStyle}>
      <li>
        <Swatch colour={WITHIN_COLOUR} />
        Within {toleranceMm} mm: {share(result.within)}
      </li>
      <li>
        <Swatch colour={LEFT_COLOUR} />
        Material left: {share(result.leftover)}
        {result.leftover > 0 ? `, up to ${result.mostLeftMm.toFixed(2)} mm` : ''}
      </li>
      <li>
        <Swatch colour={DEEP_COLOUR} />
        Cut too deep: {share(result.gouged)}
        {result.gouged > 0 ? `, up to ${result.deepestGougeMm.toFixed(2)} mm` : ''}
      </li>
    </ul>
  );
}

function Swatch(props: { readonly colour: string }): JSX.Element {
  return <span aria-hidden="true" style={{ ...swatchStyle, background: props.colour }} />;
}

const columnStyle: React.CSSProperties = { display: 'grid', gap: 2 };

const toggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

const noteStyle: React.CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--lf-text-muted)',
  fontSize: 'var(--lf-text-xs)',
};

const resultStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '2px 0 0',
  padding: 0,
  display: 'grid',
  gap: 2,
  fontSize: 'var(--lf-text-xs)',
};

const swatchStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 9,
  height: 9,
  marginRight: 6,
  borderRadius: 2,
  verticalAlign: 'middle',
};
