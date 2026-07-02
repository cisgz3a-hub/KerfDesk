// CNC tiling controls (Phase H.10, F-CNC19) — mounted in the Material &
// Bit card. Enabling splits Save G-code into one file per tile (indexed
// row/col grid) with optional registration holes in the overlap strips.

import { DEFAULT_CNC_TILING, type CncMachineConfig, type CncTiling } from '../../core/scene';
import { useStore } from '../state';
import { useDebouncedCommit } from '../layers/use-debounced-commit';

export function CncTilingPanel(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const updateCncMachine = useStore((s) => s.updateCncMachine);
  const tiling = props.machine.tiling;
  return (
    <details style={detailsStyle} open={tiling !== undefined}>
      <summary
        style={summaryStyle}
        title="Split jobs larger than the bed into an indexed tile grid; Save G-code writes one file per tile."
      >
        Tiling {tiling === undefined ? '(off)' : '(on)'}
      </summary>
      <label style={enableRowStyle}>
        <input
          type="checkbox"
          checked={tiling !== undefined}
          onChange={(e) =>
            updateCncMachine({ tiling: e.target.checked ? DEFAULT_CNC_TILING : null })
          }
          aria-label="Enable tiling"
          title="Enable per-tile export. The operator slides the stock and re-zeros XY on each tile frame."
        />
        <span>Split the job into tiles</span>
      </label>
      {tiling !== undefined ? <TilingFields tiling={tiling} /> : null}
    </details>
  );
}

function TilingFields(props: { readonly tiling: CncTiling }): JSX.Element {
  const updateCncMachine = useStore((s) => s.updateCncMachine);
  const { tiling } = props;
  const commit = (patch: Partial<CncTiling>): void =>
    updateCncMachine({ tiling: { ...tiling, ...patch } });
  return (
    <>
      <TilingNumberRow
        label="Tile width"
        value={tiling.tileWidthMm}
        min={20}
        max={1500}
        title="Tile size along X — at most the bed width."
        onCommit={(tileWidthMm) => commit({ tileWidthMm })}
      />
      <TilingNumberRow
        label="Tile height"
        value={tiling.tileHeightMm}
        min={20}
        max={1500}
        title="Tile size along Y — at most the bed height."
        onCommit={(tileHeightMm) => commit({ tileHeightMm })}
      />
      <TilingNumberRow
        label="Overlap"
        value={tiling.overlapMm}
        min={0}
        max={100}
        title="Shared strip between adjacent tiles; registration holes drill inside it."
        onCommit={(overlapMm) => commit({ overlapMm })}
      />
      <label style={enableRowStyle}>
        <input
          type="checkbox"
          checked={tiling.registrationHoles}
          onChange={(e) => commit({ registrationHoles: e.target.checked })}
          aria-label="Drill registration holes"
          title="Drill dowel-pin holes at identical stock positions in adjacent tiles so the stock re-indexes physically."
        />
        <span>Registration holes</span>
      </label>
    </>
  );
}

function TilingNumberRow(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly title: string;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: props.onCommit,
    parse: (s) => {
      const n = Number.parseFloat(s);
      if (!Number.isFinite(n)) return props.value;
      return Math.max(props.min, Math.min(props.max, n));
    },
  });
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={1}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        aria-label={props.label}
        title={props.title}
        style={inputStyle}
      />
      <span style={unitStyle}>mm</span>
    </div>
  );
}

const detailsStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '4px 6px',
  marginTop: 4,
};
const summaryStyle: React.CSSProperties = {
  fontSize: 12,
  cursor: 'pointer',
  userSelect: 'none',
  color: 'var(--lf-text-muted)',
};
const enableRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  margin: '6px 0',
  cursor: 'pointer',
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};
const labelStyle: React.CSSProperties = { width: 108, fontSize: 12, color: 'var(--lf-text-muted)' };
const inputStyle: React.CSSProperties = { width: 80, padding: '2px 6px' };
const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
