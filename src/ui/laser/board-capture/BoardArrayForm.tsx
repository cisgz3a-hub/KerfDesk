// BoardArrayForm — the array / step-and-repeat control of the board-capture
// panel (ADR-125 A2). Tiles copies of the one selected design across the placed
// board: either "fit as many as fit" (auto-count) or an explicit rows × cols,
// with a spacing gap. Turns one coaster/keychain into a full production sheet.

import { useState } from 'react';
import type { TileLayout } from '../../../core/scene';
import { Button, NumberInput } from '../../kit';

export function BoardArrayForm({
  disabled,
  onArray,
}: {
  readonly disabled: boolean;
  readonly onArray: (layout: TileLayout) => void;
}): JSX.Element {
  const [autoFit, setAutoFit] = useState(true);
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('3');
  const [spacing, setSpacing] = useState('2');
  // Reject a non-finite spacing (e.g. a huge literal parsing to Infinity), which
  // would propagate NaN into every tiled copy's transform.
  const parsedGap = Number(spacing);
  const gap = Number.isFinite(parsedGap) && parsedGap > 0 ? parsedGap : 0;

  const handleArray = (): void => {
    onArray(
      autoFit
        ? { kind: 'fill', gapXMm: gap, gapYMm: gap }
        : { kind: 'grid', rows: countOr(rows), cols: countOr(cols), gapXMm: gap, gapYMm: gap },
    );
  };

  return (
    <div style={formStyle}>
      <p style={hintStyle}>Or fill the board with copies of the selected design:</p>
      <label style={checkStyle}>
        <input
          type="checkbox"
          title="Fill the board with as many copies as fit, instead of a fixed rows × cols"
          checked={autoFit}
          onChange={(event) => setAutoFit(event.target.checked)}
        />
        Fit as many as fit
      </label>
      {!autoFit && (
        <div style={rowStyle}>
          <NumberInput
            aria-label="Rows"
            value={rows}
            min={1}
            step={1}
            style={inputStyle}
            onChange={(event) => setRows(event.target.value)}
          />
          <span aria-hidden>×</span>
          <NumberInput
            aria-label="Columns"
            value={cols}
            min={1}
            step={1}
            style={inputStyle}
            onChange={(event) => setCols(event.target.value)}
          />
          <span style={mutedStyle}>rows × cols</span>
        </div>
      )}
      <div style={rowStyle}>
        <NumberInput
          aria-label="Spacing in mm"
          value={spacing}
          min={0}
          step={1}
          style={inputStyle}
          onChange={(event) => setSpacing(event.target.value)}
        />
        <span style={mutedStyle}>mm spacing</span>
      </div>
      <Button
        variant="primary"
        disabled={disabled}
        title={
          disabled
            ? 'Select exactly one design to array across the board'
            : 'Tile copies of the design across the board'
        }
        onClick={handleArray}
      >
        Array on board
      </Button>
    </div>
  );
}

function countOr(raw: string): number {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value >= 1 ? value : 1;
}

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 6,
};
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const checkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const inputStyle: React.CSSProperties = { width: 56 };
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
