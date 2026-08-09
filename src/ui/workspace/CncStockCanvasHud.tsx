import { useState } from 'react';
import type { CncStock } from '../../core/scene';
import { Icon } from '../kit';
import { useDebouncedCommit } from '../layers/use-debounced-commit';
import { useStore } from '../state';
import { canvasTheme } from '../theme/canvas-theme';
import { cncStockCanvasHudStyles as styles } from './cnc-stock-canvas-hud-styles';

const STOCK_FIELDS_ID = 'cnc-stock-canvas-fields';

type StockNumberFieldProps = {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly title: string;
  readonly onCommit: (value: number) => void;
};

type MachineUpdater = ReturnType<typeof useStore.getState>['updateCncMachine'];

/** Edits the CNC workpiece directly beside its visible canvas footprint. */
export function CncStockCanvasHud(): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  const updateCncMachine = useStore((state) => state.updateCncMachine);
  const [isExpanded, setIsExpanded] = useState(false);
  if (machine?.kind !== 'cnc') return null;

  const stock = machine.stock;
  return (
    <section
      aria-label="Stock controls"
      className="lf-chip"
      style={isExpanded ? styles.panel : { ...styles.panel, ...styles.collapsedPanel }}
    >
      {isExpanded ? (
        <span aria-hidden="true" style={styles.connector}>
          <span style={styles.connectorDot} />
        </span>
      ) : null}
      <StockHeader
        isExpanded={isExpanded}
        stock={stock}
        onToggle={() => setIsExpanded((current) => !current)}
      />
      {isExpanded ? <StockFields stock={stock} onCommit={updateCncMachine} /> : null}
    </section>
  );
}

function StockHeader(props: {
  readonly isExpanded: boolean;
  readonly stock: CncStock;
  readonly onToggle: () => void;
}): JSX.Element {
  const { isExpanded, stock, onToggle } = props;
  return (
    <button
      type="button"
      className="lf-btn lf-btn--ghost"
      style={
        isExpanded
          ? styles.headerButton
          : { ...styles.headerButton, ...styles.collapsedHeaderButton }
      }
      aria-expanded={isExpanded}
      aria-controls={STOCK_FIELDS_ID}
      aria-label={isExpanded ? 'Collapse Stock controls' : 'Expand Stock controls'}
      title={isExpanded ? 'Collapse Stock controls' : 'Expand Stock controls'}
      onClick={onToggle}
    >
      {isExpanded ? (
        <span style={styles.stockIcon}>
          <Icon name="square" size={18} />
        </span>
      ) : null}
      <span style={styles.headingText}>
        <strong style={isExpanded ? styles.title : { ...styles.title, ...styles.collapsedTitle }}>
          Stock
        </strong>
        <span
          style={isExpanded ? styles.summary : { ...styles.summary, ...styles.collapsedSummary }}
        >
          {stockSummary(stock)}
        </span>
      </span>
      <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={isExpanded ? 16 : 12} />
    </button>
  );
}

function StockFields(props: {
  readonly stock: CncStock;
  readonly onCommit: MachineUpdater;
}): JSX.Element {
  const { stock, onCommit } = props;
  return (
    <div id={STOCK_FIELDS_ID} style={styles.body}>
      <ThicknessField stock={stock} onCommit={onCommit} />
      <StockPairGroup
        label="Size"
        first={{
          label: 'Stock width',
          prefix: 'W',
          value: stock.widthMm,
          min: 1,
          max: 1500,
          title: 'Workpiece width (X). Toolpaths outside the stock footprint raise an advisory.',
          onCommit: (widthMm) => onCommit({ stock: { widthMm } }),
        }}
        second={{
          label: 'Stock height',
          prefix: 'H',
          value: stock.heightMm,
          min: 1,
          max: 1500,
          title: 'Workpiece height (Y). Toolpaths outside the stock footprint raise an advisory.',
          onCommit: (heightMm) => onCommit({ stock: { heightMm } }),
        }}
      />
      <div style={styles.originRow}>
        <StockPairGroup
          label="Origin"
          first={{
            label: 'Stock origin X',
            prefix: 'X',
            value: stock.originOffset.x,
            min: -1500,
            max: 1500,
            title: "Machine-coordinate X of the stock's near-left corner.",
            onCommit: (x) => commitCurrentOriginOffset('x', x, onCommit),
          }}
          second={{
            label: 'Stock origin Y',
            prefix: 'Y',
            value: stock.originOffset.y,
            min: -1500,
            max: 1500,
            title: "Machine-coordinate Y of the stock's near-left corner.",
            onCommit: (y) => commitCurrentOriginOffset('y', y, onCommit),
          }}
        />
        <StockOriginDiagram />
      </div>
    </div>
  );
}

function commitCurrentOriginOffset(axis: 'x' | 'y', value: number, onCommit: MachineUpdater): void {
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') return;
  const originOffset =
    axis === 'x'
      ? { ...machine.stock.originOffset, x: value }
      : { ...machine.stock.originOffset, y: value };
  onCommit({ stock: { originOffset } });
}

function ThicknessField(props: {
  readonly stock: CncStock;
  readonly onCommit: MachineUpdater;
}): JSX.Element {
  return (
    <div style={styles.thicknessRow}>
      <span style={styles.groupLabel}>Thickness</span>
      <StockNumberField
        label="Stock thickness"
        value={props.stock.thicknessMm}
        min={0.1}
        max={200}
        step={0.05}
        title="Workpiece thickness. Cutting deeper than this is allowed — Job Review warns how far past the stock bottom the cut goes."
        onCommit={(thicknessMm) => props.onCommit({ stock: { thicknessMm } })}
      />
      <span style={styles.unit}>mm</span>
    </div>
  );
}

type PairField = Omit<StockNumberFieldProps, 'step'> & { readonly prefix: string };

function StockPairGroup(props: {
  readonly label: string;
  readonly first: PairField;
  readonly second: PairField;
}): JSX.Element {
  return (
    <div style={styles.pairGroup}>
      <span style={styles.groupLabel}>
        {props.label} <span style={styles.unit}>mm</span>
      </span>
      <div style={styles.pairFields}>
        <PrefixedField field={props.first} />
        <PrefixedField field={props.second} />
      </div>
    </div>
  );
}

function PrefixedField(props: { readonly field: PairField }): JSX.Element {
  const field = props.field;
  return (
    <label style={styles.prefixedField}>
      <span style={styles.prefix}>{field.prefix}</span>
      <StockNumberField
        label={field.label}
        value={field.value}
        min={field.min}
        max={field.max}
        step={1}
        title={field.title}
        onCommit={field.onCommit}
      />
    </label>
  );
}

function StockNumberField(props: StockNumberFieldProps): JSX.Element {
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: props.onCommit,
    parse: (text) => clampNumber(text, props.value, props.min, props.max),
  });
  return (
    <input
      type="number"
      className="lf-input"
      aria-label={props.label}
      title={props.title}
      min={props.min}
      max={props.max}
      step={props.step}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={styles.input}
    />
  );
}

function StockOriginDiagram(): JSX.Element {
  return (
    <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true" style={styles.diagram}>
      <rect
        x="8"
        y="6"
        width="38"
        height="38"
        fill={canvasTheme.stockFill}
        stroke={canvasTheme.stockStroke}
      />
      <path d="M8 3V48H54M8 48l-3-3M8 48l3-3" fill="none" stroke="currentColor" />
      <circle cx="8" cy="48" r="4" fill={canvasTheme.selection} />
      <text x="49" y="56" fontSize="9" fill="currentColor">
        X
      </text>
      <text x="0" y="8" fontSize="9" fill="currentColor">
        Y
      </text>
    </svg>
  );
}

function stockSummary(stock: CncStock): string {
  return `${stock.widthMm} × ${stock.heightMm} × ${stock.thicknessMm} mm`;
}

function clampNumber(text: string, fallback: number, min: number, max: number): number {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
