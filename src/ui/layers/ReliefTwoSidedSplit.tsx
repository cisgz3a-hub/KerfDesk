// "Two-sided carving" for an STL relief (ADR-580): split it into a side A
// (top) and side B (bottom) relief for the two-sided setup (ADR-573), so a
// model that needs both faces carved can be cut in two setups with a flip.

import { useState } from 'react';
import type { MeshReliefObject, ReliefTwoSidedSplitRecord } from '../../core/scene/relief';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

const DEFAULT_WEB_MM = 1;
const DEFAULT_MARGIN_MM = 10;

export function ReliefTwoSidedSplit(props: { readonly relief: MeshReliefObject }): JSX.Element {
  const stockThicknessMm = useStore((s) =>
    s.project.machine?.kind === 'cnc' ? s.project.machine.stock.thicknessMm : undefined,
  );
  const record = props.relief.twoSidedSplit;
  if (record !== undefined) {
    return <ReliefSplitSideNote record={record} stockThicknessMm={stockThicknessMm} />;
  }
  return <ReliefSplitControls relief={props.relief} stockThicknessMm={stockThicknessMm} />;
}

// ADR-580 Amendment 1: a side follows the stock, so the note names the stock
// it is carved from now, not the one it was split for.
function ReliefSplitSideNote(props: {
  readonly record: ReliefTwoSidedSplitRecord;
  readonly stockThicknessMm: number | undefined;
}): JSX.Element {
  const { record, stockThicknessMm } = props;
  const name = record.side === 'A' ? 'Side A (top)' : 'Side B (bottom)';
  const stock = stockThicknessMm ?? record.stockThicknessMm;
  return (
    <details style={detailsStyle}>
      <summary title="This relief is one side of a two-sided carve">Two-sided carving</summary>
      <p style={noteStyle}>
        {name} of a split {format(record.modelDepthMm)} mm model. Both sides follow Machine Setup ›
        Stock: they keep the model centred in the {format(stock)} mm stock with the holding web they
        were split with.
        {stock < record.modelDepthMm
          ? ` The stock is thinner than the model, so both stock faces cut it down: the part comes out ${format(stock)} mm thick.`
          : ''}
      </p>
    </details>
  );
}

function ReliefSplitControls(props: {
  readonly relief: MeshReliefObject;
  readonly stockThicknessMm: number | undefined;
}): JSX.Element {
  const { relief, stockThicknessMm } = props;
  const split = useStore((s) => s.splitReliefForTwoSides);
  const pushToast = useToastStore((s) => s.pushToast);
  const [splitMm, setSplitMm] = useState(relief.reliefDepthMm / 2);
  const [webMm, setWebMm] = useState(DEFAULT_WEB_MM);
  const [marginMm, setMarginMm] = useState(DEFAULT_MARGIN_MM);
  const create = (): void => {
    const result = split(relief.id, { splitHeightMm: splitMm, webMm, marginMm });
    if (result.kind === 'error') {
      pushToast(result.reason, 'error');
      return;
    }
    pushToast(
      'Created side A (top) and side B (bottom) reliefs, centred in the ' +
        `${format(stockThicknessMm ?? result.stockThicknessMm)} mm stock` +
        (result.setupEnabled ? ' and switched on two-sided machining' : '') +
        '. Both follow a later change to the stock thickness. Carve side A, flip the stock as ' +
        'set in Machine Setup › Two-sided machining, set Z0 on ' +
        'the new top, then make side B active and carve it.' +
        (result.fitsStock
          ? ''
          : ` The stock is thinner than the ${format(relief.reliefDepthMm)} mm model, so both ` +
            'stock faces cut the model down and the web still holds it. Enter the board’s real ' +
            'thickness in Machine Setup › Stock: both sides follow it.'),
      result.fitsStock ? 'success' : 'warning',
    );
  };
  return (
    <details style={detailsStyle}>
      <summary title="Split this STL into a top and a bottom relief for carving both faces with a flip">
        Two-sided carving
      </summary>
      <p style={noteStyle}>
        A router reaches the model from above only. Splitting makes a side A relief (the top, down
        to the split) and a side B relief (the bottom, carved after flipping the stock), centred in
        the {stockThicknessMm === undefined ? '' : `${format(stockThicknessMm)} mm `}stock, with a
        holding web at the split and a stock frame round the outside. Both sides follow a later
        change to the stock thickness.
      </p>
      <NumberRow
        label="Split height"
        value={splitMm}
        onChange={setSplitMm}
        title="Height of the split plane above the model's lowest point."
      />
      <NumberRow
        label="Holding web"
        value={webMm}
        onChange={setWebMm}
        title="Stock left at the split round the model to hold it until it is cut free. 0 = none: the part comes free during side B."
      />
      <NumberRow
        label="Margin"
        value={marginMm}
        onChange={setMarginMm}
        title="Clear space round the model inside the frame. Make it wider than the roughing bit."
      />
      <button
        type="button"
        onClick={create}
        title="Replace this relief with its side A and side B reliefs (one undo step)."
      >
        Create side A and side B
      </button>
    </details>
  );
}

function NumberRow(props: {
  readonly label: string;
  readonly value: number;
  readonly title: string;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label style={rowStyle}>
      <span>{props.label}</span>
      <span style={controlStyle}>
        <input
          type="number"
          step={0.5}
          min={0}
          value={Number(props.value.toFixed(3))}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value)) props.onChange(value);
          }}
          aria-label={`Two-sided ${props.label.toLowerCase()} (mm)`}
          title={props.title}
          style={inputStyle}
        />
        <span>mm</span>
      </span>
    </label>
  );
}

function format(value: number): string {
  return String(Number(value.toFixed(2)));
}

const detailsStyle: React.CSSProperties = { marginTop: 6 };
const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-faint)',
  margin: '4px 0 6px 0',
};
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
const controlStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
};
