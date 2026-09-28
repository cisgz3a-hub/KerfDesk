// The laser burn preview's switches in the Inspector's readouts (ADR-487).

// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import {
  STOCK_MATERIAL_LABEL,
  STOCK_MATERIALS,
  type StockMaterial,
} from '../viewer3d/scene-stock-materials';
import type { BurnShadeBy, LaserBurn } from './use-laser-burn';
import { BurnEnergyNote } from './BurnEnergyNote';

// On a burn the height map shades the burn itself.
const BURN_MATERIAL_LABEL: Readonly<Record<StockMaterial, string>> = {
  ...STOCK_MATERIAL_LABEL,
  height: 'Burn map',
};

export function InspectorBurnControl(props: { readonly burn: LaserBurn }): JSX.Element {
  const { burn } = props;
  return (
    <div style={columnStyle}>
      <label style={toggleStyle}>
        <input
          type="checkbox"
          title="Show the sheet the program burns, darkened by each move's power as far as playback has got"
          checked={burn.shown}
          onChange={(event) => burn.onShownChange(event.currentTarget.checked)}
        />
        Show burn preview
      </label>
      <label style={toggleStyle}>
        <input
          type="checkbox"
          title="Draw the toolpath over the burn"
          checked={burn.toolpathShown}
          disabled={!burn.shown}
          onChange={(event) => burn.onToolpathShownChange(event.currentTarget.checked)}
        />
        Toolpath over the burn
      </label>
      {burn.wrap === null ? null : (
        <label style={toggleStyle}>
          <input
            type="checkbox"
            title="Wrap the burn round the work the rotary turns, as it comes off the machine"
            checked={burn.wrap.shown}
            disabled={!burn.shown}
            onChange={(event) => burn.wrap?.onShownChange(event.currentTarget.checked)}
          />
          Wrap round the rotary (⌀ {burn.wrap.diameterMm} mm)
        </label>
      )}
      <label style={toggleStyle}>
        Material
        <select
          aria-label="Burn material"
          title="What the program burns, as drawn"
          value={burn.material}
          disabled={!burn.shown}
          onChange={(event) => burn.onMaterialChange(event.currentTarget.value as StockMaterial)}
          style={selectStyle}
        >
          {STOCK_MATERIALS.map((material) => (
            <option key={material} value={material}>
              {BURN_MATERIAL_LABEL[material]}
            </option>
          ))}
        </select>
      </label>
      <label style={toggleStyle}>
        Shade by
        <select
          aria-label="Shade the burn by"
          title="Energy counts power, speed, the laser's watts and its beam against the material; power alone is LightBurn's preview"
          value={burn.shadeBy}
          disabled={!burn.shown}
          onChange={(event) => burn.onShadeByChange(event.currentTarget.value as BurnShadeBy)}
          style={selectStyle}
        >
          <option value="energy">Energy (power and speed)</option>
          <option value="power">Power only</option>
        </select>
      </label>
      {!burn.shown ? null : burn.shadeBy === 'energy' ? (
        <BurnEnergyNote energy={burn.energy} material={burn.material} />
      ) : (
        <p style={noteStyle}>
          Darker the more power, S {burn.fullPowerS} darkest. Speed is not counted.
        </p>
      )}
      {burn.failed ? <p style={noteStyle}>The burn could not be shown here.</p> : null}
    </div>
  );
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
