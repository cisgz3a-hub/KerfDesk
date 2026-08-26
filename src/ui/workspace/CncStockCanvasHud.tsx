import { useState } from 'react';
import type { CncStock } from '../../core/scene';
import { Icon } from '../kit';
import { openMachineSetup } from '../laser/device-setup';
import { useStore } from '../state';
import { cncStockCanvasHudStyles as styles } from './cnc-stock-canvas-hud-styles';

const STOCK_DETAILS_ID = 'cnc-stock-canvas-reference-details';

/** Shows canvas-adjacent stock facts without creating a second settings owner. */
export function CncStockCanvasHud(): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  const [isExpanded, setIsExpanded] = useState(false);
  if (machine?.kind !== 'cnc') return null;

  return (
    <section
      aria-label="Stock from Startup Setup"
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
        stock={machine.stock}
        onToggle={() => setIsExpanded((current) => !current)}
      />
      {isExpanded ? <StockReferenceDetails stock={machine.stock} /> : null}
    </section>
  );
}

function StockHeader(props: {
  readonly isExpanded: boolean;
  readonly stock: CncStock;
  readonly onToggle: () => void;
}): JSX.Element {
  const action = props.isExpanded ? 'Collapse' : 'Expand';
  return (
    <button
      type="button"
      className="lf-btn lf-btn--ghost"
      style={
        props.isExpanded
          ? styles.headerButton
          : { ...styles.headerButton, ...styles.collapsedHeaderButton }
      }
      aria-expanded={props.isExpanded}
      aria-controls={STOCK_DETAILS_ID}
      aria-label={`${action} stock reference from Startup Setup`}
      title="Read-only here. Select to view the saved stock or edit it in Startup Setup."
      onClick={props.onToggle}
    >
      {props.isExpanded ? (
        <span style={styles.stockIcon}>
          <Icon name="square" size={18} />
        </span>
      ) : null}
      <span style={styles.headingText}>
        <strong style={props.isExpanded ? styles.title : styles.collapsedTitle}>Stock</strong>
        <span style={props.isExpanded ? styles.summary : styles.collapsedSummary}>
          {stockSummary(props.stock)}
        </span>
      </span>
      <Icon name={props.isExpanded ? 'chevron-up' : 'chevron-down'} size={14} />
    </button>
  );
}

function StockReferenceDetails(props: { readonly stock: CncStock }): JSX.Element {
  return (
    <div id={STOCK_DETAILS_ID} style={styles.body}>
      <p style={styles.note}>
        Read-only here. Stock size, thickness, and origin are managed in CNC Startup Setup.
      </p>
      <dl style={styles.factGrid}>
        <dt style={styles.factLabel}>Dimensions</dt>
        <dd style={styles.factValue}>{stockSummary(props.stock)}</dd>
        <dt style={styles.factLabel}>Origin</dt>
        <dd style={styles.factValue}>{originSummary(props.stock)}</dd>
      </dl>
      <div style={styles.actionRow}>
        <button
          type="button"
          onClick={() => openMachineSetup({ kind: 'cnc', field: 'stock' })}
          title="Open CNC Startup Setup at the stock fields."
        >
          Edit in Startup Setup
        </button>
      </div>
    </div>
  );
}

function stockSummary(stock: CncStock): string {
  return `${formatNumber(stock.widthMm)} x ${formatNumber(stock.heightMm)} x ${formatNumber(stock.thicknessMm)} mm`;
}

function originSummary(stock: CncStock): string {
  return `X ${formatNumber(stock.originOffset.x)}, Y ${formatNumber(stock.originOffset.y)} mm`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
