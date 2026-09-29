// What the burn preview's energy shading counts, and a scale of the energy
// the program puts in against the material's full burn (ADR-501).

// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import { STOCK_MATERIAL_LABEL, type StockMaterial } from '../viewer3d/scene-stock-materials';
import type { BurnEnergy } from './use-laser-burn';

export function BurnEnergyNote(props: {
  readonly energy: BurnEnergy;
  readonly material: StockMaterial;
}): JSX.Element {
  const { energy } = props;
  const full = energy.fullDoseJPerMm2;
  const watts = energy.assumedPower
    ? `${energy.opticalPowerW} W (taken, as the machine profile gives no laser power)`
    : `${energy.opticalPowerW} W`;
  return (
    <div style={columnStyle}>
      <p style={noteStyle}>
        {`Darker the more energy per mm²: power × ${watts} ÷ (speed × ${energy.beamMm} mm beam). `}
        {`${materialName(props.material)} burns fully at about ${joules(full)}`}
        {energy.range === null
          ? '. '
          : `; this program puts in ${joules(energy.range.min)} to ${joules(energy.range.max)}. `}
        Uncalibrated: it shows which parts burn darker, not the exact colour.
      </p>
      {energy.range === null ? null : <EnergyScale full={full} range={energy.range} />}
    </div>
  );
}

// A strip from bare to the full burn and past it, with the program's range on it.
function EnergyScale(props: {
  readonly full: number;
  readonly range: { readonly min: number; readonly max: number };
}): JSX.Element {
  const { full, range } = props;
  const top = Math.max(full * 1.25, Math.min(range.max, full * 2));
  const at = (dose: number): number => Math.min(100, (100 * Math.max(0, dose)) / top);
  const left = at(range.min);
  const width = Math.max(1, at(range.max) - left);
  return (
    <div
      role="img"
      aria-label={`This program from ${joules(range.min)} to ${joules(range.max)}; full burn at ${joules(full)}`}
      style={scaleStyle}
    >
      <div style={{ ...barStyle, background: gradient(at(full)) }} />
      <div style={{ ...rangeStyle, left: `${left}%`, width: `${width}%` }} />
      <div style={{ ...fullMarkStyle, left: `${at(full)}%` }} />
    </div>
  );
}

function gradient(fullAt: number): string {
  return `linear-gradient(to right, var(--lf-bg-2), var(--lf-text) ${fullAt}%, var(--lf-text))`;
}

function materialName(material: StockMaterial): string {
  // Flat grey and the burn map burn as wood.
  return material === 'grey' || material === 'height' ? 'Wood' : STOCK_MATERIAL_LABEL[material];
}

function joules(value: number): string {
  return `${Number(value.toPrecision(2)).toString()} J/mm²`;
}

const columnStyle: React.CSSProperties = { display: 'grid', gap: 4 };

const noteStyle: React.CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--lf-text-muted)',
  fontSize: 'var(--lf-text-xs)',
};

const scaleStyle: React.CSSProperties = { position: 'relative', height: 12 };

const barStyle: React.CSSProperties = {
  position: 'absolute',
  inset: '3px 0',
  borderRadius: 2,
};

const rangeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  border: '2px solid var(--lf-accent)',
  borderRadius: 3,
  boxSizing: 'border-box',
};

const fullMarkStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: 1,
  background: 'var(--lf-warning)',
};
